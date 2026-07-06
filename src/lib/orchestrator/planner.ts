import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import {
  assertRunnable,
  buildClaudeEnv,
  resolveProjectExec,
} from "../claude-auth";
import { LOGS_DIR } from "../db";
import { getProvider } from "../integrations";
import {
  getPlan,
  listAttachments,
  listPlans,
  listSteps,
  replaceSteps,
  updatePlan,
} from "../plan-repo";
import {
  cancelPlanInteractions,
  getIntegration,
  getResolvedProject,
} from "../repo";
import { getSettings } from "../settings";
import { buildSpecContext, detectSpecFramework, type SpecFramework } from "../specs";
import type { Plan, Project, RefineResult } from "../types";
import { buildAttachmentBlock, buildRunExtras } from "./run-config";

// Refinement runs are spawned DETACHED and stream stream-json to a log file, so
// they survive a Leo restart (same pattern as task runs). We track them by pid
// and finalize by reading the result from the log. On boot we re-attach.
const g = globalThis as unknown as {
  __leoRefinePids?: Map<number, number>; // planId -> pid
  __leoRefineWatched?: Set<number>;
};
const refinePids: Map<number, number> = g.__leoRefinePids ?? new Map();
g.__leoRefinePids = refinePids;
const refineWatched: Set<number> = g.__leoRefineWatched ?? new Set();
g.__leoRefineWatched = refineWatched;

export function refinementActive(planId: number): boolean {
  return refinePids.has(planId);
}

/** Kill a plan's in-flight refinement process (if any) and stop watching it. */
export function stopRefinement(planId: number): void {
  const pid = refinePids.get(planId);
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  refinePids.delete(planId);
  refineWatched.delete(planId);
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function appendLine(logPath: string, obj: unknown): void {
  try {
    fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");
  } catch {
    /* ignore */
  }
}

/** Pull fresh seed context from the originating integration, if any. */
async function fetchSeedContext(plan: Plan): Promise<string> {
  if (
    !plan.source_integration_id ||
    plan.source_type === "manual" ||
    !plan.source_external_id
  ) {
    return "";
  }
  try {
    const integ = await getIntegration(plan.source_integration_id);
    const provider = integ ? getProvider(integ.type) : null;
    if (integ && provider?.fetchTaskContext) {
      return await provider.fetchTaskContext(
        integ.config as unknown as Record<string, unknown>,
        plan.source_external_id,
      );
    }
  } catch {
    /* best-effort */
  }
  return "";
}

/** When set, the refinement REVISES an existing plan instead of building one
 *  from the seed — Claude is given its previous output plus the human's feedback. */
interface RefineIteration {
  feedback: string;
  refinedSpec: string;
  steps: { title: string; spec: string }[];
}

function buildRefinePrompt(
  project: Project,
  plan: Plan,
  seedContext: string,
  specContext: string,
  attachmentBlock: string,
  interactive: boolean,
  framework: SpecFramework | null,
  iteration: RefineIteration | null,
): string {
  const sourceLabel =
    plan.source_type === "manual"
      ? "manual"
      : plan.source_type.charAt(0).toUpperCase() + plan.source_type.slice(1);

  const sections: string[] = [
    `You are a senior engineer and product analyst doing REQUIREMENTS REFINEMENT for the "${project.name}" repository.`,
    `You are STRICTLY READ-ONLY: do NOT modify files, do NOT run commands that change state, do NOT commit or push. Use Read/Grep/Glob to inspect the codebase so your plan is grounded in how this project actually works (its CLAUDE.md, conventions, modules, and validations).`,
    `If MCP tools are available (e.g. Supabase), use them ONLY to INSPECT — list tables, read rows, SELECT queries, get configs. NEVER call MCP tools that mutate: no INSERT/UPDATE/DELETE or DDL, no apply_migration, no deploy, no create/update/delete of projects/branches/functions. They are for grounding the plan, not for making changes.`,
    `\n## Seed (source: ${sourceLabel})`,
    `Title: ${plan.title}`,
    plan.source_url ? `Link: ${plan.source_url}` : "",
    `\nObjective / raw request:\n${plan.objective || "(none provided)"}`,
  ];

  if (seedContext.trim()) {
    sections.push(`\n## Source context from ${sourceLabel}`, seedContext.trim());
  }

  if (project.prompt_rules.trim()) {
    sections.push(
      `\n## Project rules (can / must / must-not)`,
      project.prompt_rules.trim(),
    );
  }

  if (specContext.trim()) {
    sections.push(`\n${specContext.trim()}`);
  }

  if (attachmentBlock.trim()) {
    sections.push(`\n${attachmentBlock.trim()}`);
  }

  if (framework) {
    sections.push(
      `\n## Requirements framework: ${framework.label}`,
      framework.guidance,
    );
  }

  if (iteration) {
    const stepsBlock = iteration.steps.length
      ? iteration.steps
          .map(
            (s, i) =>
              `### Step ${i + 1}: ${s.title}\n${s.spec || "(no detail)"}`,
          )
          .join("\n\n")
      : "(no steps yet)";
    sections.push(
      `\n## Current plan (your previous output — REVISE this, do not start over)`,
      `Refined requirement so far:\n${iteration.refinedSpec.trim() || "(empty)"}`,
      `\nSteps so far:\n${stepsBlock}`,
      `\n## Requested changes (human feedback)`,
      `The human reviewed the plan above and asks for the following. Treat this as the priority for this revision:`,
      iteration.feedback.trim(),
    );
  }

  if (interactive) {
    const frameworkNote = framework
      ? ` Frame your questions around the ${framework.label} expectations above.`
      : "";
    sections.push(
      `\n## Ask the human FIRST (clarify before planning)`,
      `You can talk to the human through the \`mcp__leo__ask_user\` tool. The whole point of this refinement is to remove ambiguity, so DO use it.`,
      `1. After a quick read of the request, the source context and the repo, list the open questions whose answers would change the plan (scope boundaries, expected behavior, edge cases, acceptance criteria, data/contracts, non-functional constraints, which existing files/specs to touch).${frameworkNote}`,
      `2. Ask the MOST IMPORTANT ones via \`mcp__leo__ask_user\` — one focused question per call, and provide an \`options\` array when there are natural choices so the human can answer in one click. Ask only what genuinely blocks a good plan: aim for the few that matter (roughly 1–5), not a long interrogation. Prefer questions over guessing on anything that would materially change the work.`,
      `3. WAIT for each answer and incorporate it. If a question times out or is skipped, proceed with your best, clearly-stated assumption.`,
      `4. Only then produce the refined requirement and steps below, reflecting the answers.`,
      `(Do NOT use \`mcp__leo__ask_user\` for trivia you can resolve by reading the code — reserve it for real product/scope decisions only the human can make.)`,
    );
  }

  if (iteration) {
    sections.push(
      `\n## Your job (REVISION)`,
      `You already produced the plan shown in "Current plan". The human reviewed it and left "Requested changes". Revise the plan to fully address that feedback — do NOT rebuild it from the seed.`,
      `1. Investigate ONLY the parts of the codebase needed to act on the feedback. Read efficiently; don't re-read everything. As soon as you can satisfy the feedback, STOP and output the plan.`,
      `2. PRESERVE everything that already works: keep the existing refined requirement and steps intact except where the feedback requires a change (or where a change is needed to satisfy it). Do not regress, drop detail, or rephrase for its own sake.`,
      `3. Keep the same step-granularity philosophy: DEFAULT TO A SINGLE STEP; only split into multiple steps for genuinely independent, separately-shippable FEATURE slices. NEVER create steps for tests, validations, type-checks, commits, pushes, review, or the PR — those finish every step.`,
      `4. Re-output the COMPLETE updated plan — the full refined requirement and ALL steps (including the ones you left unchanged), in the SAME JSON format below. Do not output a diff or partial plan.`,
    );
  } else {
    sections.push(
      `\n## Your job`,
      `1. Investigate the relevant parts of the codebase to ground the work in reality (which files/modules change, existing patterns, the validations that must pass). Be EFFICIENT: read only the few files you actually need; do NOT exhaustively read tests or unrelated modules. As soon as you understand the change, STOP reading and output the plan — you have a limited number of steps.`,
      `2. Produce a precise, unambiguous refined requirement that removes guesswork for the implementing agent.`,
      `3. Decide the MINIMUM number of steps. DEFAULT TO A SINGLE STEP. Most tasks are one step.`,
      `   Only split into multiple steps when the work is genuinely large and made of independent units of FEATURE work that each deserve their own session and Pull Request (e.g. a backend change that can ship separately from a later frontend change). When unsure, use ONE step.`,
      `   CRITICAL — never create separate steps for: writing tests, running validations/linters, type-checking, committing, pushing, code review, or opening the PR. Those are part of FINISHING EVERY step — the executing agent always runs this project's validations and finalization contract on each step. So a normal change (e.g. "embed a responsive video on a page", "fix a bug", "add a field") is exactly ONE step that already includes its tests, validations, commit and PR.`,
      `   A step must be a meaningful, independently-shippable slice of the feature — never a phase ("implement", then "test", then "validate", then "commit") of the same change. If your steps would each touch the same change or only differ by lifecycle phase, collapse them into one.`,
      `   For each step give a short imperative title and a DETAILED spec: what to change, where (files/modules), and acceptance criteria.`,
    );
  }

  sections.push(
    `\n## Output format (REQUIRED)`,
    `When your analysis is complete, end your message with a SINGLE fenced json code block and nothing after it:`,
    "```json",
    `{`,
    `  "title": "<concise plan title>",`,
    `  "refined_spec": "<the overall refined requirement, markdown>",`,
    `  "steps": [`,
    `    { "title": "<imperative title>", "spec": "<detailed instructions + acceptance criteria>" }`,
    `  ]`,
    `}`,
    "```",
  );

  return sections.filter(Boolean).join("\n");
}

function buildRefineArgs(
  project: Project,
  prompt: string,
  model: string | null,
  allowedMcpTools: string[],
  extraArgs: string[],
): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    // Skip permission PROMPTS so MCP tools work headlessly (any server name),
    // while --disallowedTools still HARD-BLOCKS state-changing tools — verified:
    // disallowedTools is honored even under --dangerously-skip-permissions. This
    // keeps the refinement read-only (no file/shell edits) yet lets it inspect
    // via MCP (e.g. Supabase list/select). The prompt forbids mutating MCP calls.
    "--dangerously-skip-permissions",
    "--disallowedTools",
    "Edit,MultiEdit,Write,NotebookEdit,Bash",
    "--max-turns",
    "60",
  ];
  void allowedMcpTools; // bypass auto-approves MCP tools; kept for signature compat
  if (model && model.trim()) args.push("--model", model.trim());
  args.push(...extraArgs);
  args.push("--add-dir", project.repo_path);
  return args;
}

/**
 * Extract the balanced JSON object starting at `from`, respecting string
 * literals (so ``` code fences or braces inside string values don't confuse
 * the scan). Returns the substring from the first `{` to its matching `}`.
 */
function extractBalanced(text: string, from: number): string | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Extract the structured plan JSON from the model's free-text result. */
export function extractRefineJson(text: string): RefineResult | null {
  if (!text) return null;
  const candidates: string[] = [];

  // 1) Balanced object after a ```json marker (robust to internal code fences).
  const marker = text.indexOf("```json");
  const balanced =
    extractBalanced(text, marker >= 0 ? marker + 7 : 0) ??
    extractBalanced(text, 0);
  if (balanced) candidates.push(balanced);

  // 2) ```json fenced content (may be truncated by internal fences — try anyway).
  const fence = /```json\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) candidates.push(m[1]);

  // 3) Last resort: first '{' to last '}'.
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) candidates.push(text.slice(s, e + 1));

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim()) as Partial<RefineResult>;
      if (obj && Array.isArray(obj.steps)) {
        return {
          title: typeof obj.title === "string" ? obj.title : undefined,
          refined_spec:
            typeof obj.refined_spec === "string" ? obj.refined_spec : "",
          steps: obj.steps
            .filter((st) => st && typeof st.title === "string")
            .map((st) => ({ title: st.title, spec: String(st.spec ?? "") })),
        };
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function parseFinalResult(logPath: string): { result?: string; is_error?: boolean } | null {
  let text: string;
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const evt = JSON.parse(l) as Record<string, unknown>;
      if (evt.type === "result") return evt as { result?: string; is_error?: boolean };
    } catch {
      /* skip */
    }
  }
  return null;
}

async function finalizeRefinement(planId: number, logPath: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan || plan.status !== "refining") {
    refinePids.delete(planId);
    refineWatched.delete(planId);
    return;
  }

  // The refinement process has exited; release any question still waiting on the
  // human so the UI stops showing a stale prompt.
  await cancelPlanInteractions(planId).catch(() => {});
  const result = parseFinalResult(logPath);
  const parsed = result?.result ? extractRefineJson(result.result) : null;

  if (!parsed || parsed.steps.length === 0) {
    appendLine(logPath, { type: "leo_refine_error" });
    // Distinguish: no result event at all (process interrupted / hit the turn
    // or rate limit) vs. a result that didn't carry the expected JSON.
    let error: string;
    if (!result) {
      error =
        "El refinamiento se interrumpió antes de terminar (probable límite de turnos o rate limit de Claude en un repo grande). Pulsa “Refinar” de nuevo para reintentar.";
    } else if (result.is_error === true) {
      error = "El refinamiento terminó con error (revisa el análisis). Pulsa “Refinar” de nuevo.";
    } else {
      error =
        "Claude no devolvió el plan en el formato esperado. Pulsa “Refinar” de nuevo para reintentar.";
    }
    await updatePlan(planId, { status: "failed", refine_pid: null, error });
    refinePids.delete(planId);
    refineWatched.delete(planId);
    return;
  }

  await replaceSteps(planId, parsed.steps);
  await updatePlan(planId, {
    status: "refined",
    refine_pid: null,
    error: null,
    refined_spec: parsed.refined_spec || plan.refined_spec,
    ...(parsed.title ? { title: parsed.title } : {}),
  });
  appendLine(logPath, { type: "leo_refine_done", steps: parsed.steps.length });
  refinePids.delete(planId);
  refineWatched.delete(planId);
}

function watchRefinement(planId: number, pid: number, logPath: string): void {
  if (refineWatched.has(planId)) return;
  refineWatched.add(planId);
  refinePids.set(planId, pid);
  const tick = () => {
    if (!refineWatched.has(planId)) return;
    if (isAlive(pid)) {
      setTimeout(tick, 2000);
      return;
    }
    void finalizeRefinement(planId, logPath).catch(() => {});
  };
  setTimeout(tick, 2000);
}

/**
 * Kick off a refinement run for a plan. Returns the updated plan.
 *
 * With `opts.feedback`, runs in ITERATION mode: Claude is given its previous
 * output (refined spec + steps) plus the feedback and asked to revise in place,
 * instead of rebuilding from the seed. Falls back to a from-scratch refinement
 * if there's no existing output to revise.
 */
export async function startRefinement(
  planId: number,
  opts?: { feedback?: string },
): Promise<Plan> {
  const plan = await getPlan(planId);
  if (!plan) throw new Error("Plan no encontrado");
  if (plan.status === "refining" || refinePids.has(planId)) return plan;

  const project = await getResolvedProject(plan.project_id);
  if (!project) throw new Error("Proyecto no encontrado");

  // Iterate on the existing output only when there IS one; otherwise feedback on
  // a draft just seeds a normal first refinement.
  const feedback = opts?.feedback?.trim() ?? "";
  const currentSteps = feedback ? await listSteps(planId) : [];
  const iteration: RefineIteration | null =
    feedback && (plan.refined_spec.trim().length > 0 || currentSteps.length > 0)
      ? {
          feedback,
          refinedSpec: plan.refined_spec,
          steps: currentSteps.map((s) => ({ title: s.title, spec: s.spec })),
        }
      : null;

  if (!fs.existsSync(project.repo_path)) {
    return (await updatePlan(planId, {
      status: "failed",
      error: `Repo path no existe: ${project.repo_path}`,
    }))!;
  }
  const gate = await assertRunnable(project);
  if (!gate.ok) {
    return (await updatePlan(planId, {
      status: "failed",
      error: gate.reason ?? "No ejecutable",
    }))!;
  }

  const settings = await getSettings(project.account_id);
  const exec = await resolveProjectExec(project);
  const seedContext = await fetchSeedContext(plan);
  const specContext = buildSpecContext(project, true);
  const attachmentBlock = buildAttachmentBlock(await listAttachments(planId));
  const framework = detectSpecFramework(project);
  const interactive = !!project.interactive;
  const prompt = buildRefinePrompt(
    project,
    plan,
    seedContext,
    specContext,
    attachmentBlock,
    interactive,
    framework,
    iteration,
  );
  const extras = buildRunExtras({
    project,
    scope: "planning",
    baseName: `plan-refine-${planId}`,
    // Lets the refinement ask the human via mcp__leo__ask_user (when the
    // project has interactivity enabled); questions land on the plan page.
    interactivePlanId: interactive ? planId : undefined,
  });
  const args = buildRefineArgs(
    project,
    prompt,
    exec.model,
    extras.allowedMcpTools,
    extras.args,
  );

  const logPath = path.join(LOGS_DIR, `plan-refine-${planId}.jsonl`);
  fs.writeFileSync(logPath, "");
  appendLine(logPath, {
    type: "leo_refine_start",
    cwd: project.repo_path,
    auth_method: exec.method,
    model: exec.model,
    prompt,
    ...(iteration ? { feedback: iteration.feedback } : {}),
  });

  let out: number;
  try {
    out = fs.openSync(logPath, "a");
  } catch (e) {
    return (await updatePlan(planId, {
      status: "failed",
      error: `No se pudo abrir el log: ${(e as Error).message}`,
    }))!;
  }

  let child: ChildProcess;
  try {
    child = spawn(settings.claude_binary_path, args, {
      cwd: project.repo_path,
      env: await buildClaudeEnv({
        accountId: project.account_id,
        method: exec.method,
        apiKey: exec.apiKey,
      }),
      detached: true,
      stdio: ["ignore", out, out],
    });
  } catch (e) {
    fs.closeSync(out);
    return (await updatePlan(planId, {
      status: "failed",
      error: `No se pudo lanzar claude: ${(e as Error).message}`,
    }))!;
  }
  fs.closeSync(out);

  if (!child.pid) {
    return (await updatePlan(planId, {
      status: "failed",
      error: "No se pudo lanzar claude (sin pid).",
    }))!;
  }
  child.once("error", (err) => {
    appendLine(logPath, { type: "leo_error", message: err.message });
  });
  child.unref();

  await updatePlan(planId, {
    status: "refining",
    error: null,
    refine_pid: child.pid,
    refine_log: logPath,
  });
  watchRefinement(planId, child.pid, logPath);
  return (await getPlan(planId))!;
}

/** On boot, re-attach to or finalize refinements left "refining". */
export async function reconcileRefinements(): Promise<void> {
  const plans = await listPlans({ status: "refining", limit: 1000 });
  for (const p of plans) {
    const logPath =
      p.refine_log ?? path.join(LOGS_DIR, `plan-refine-${p.id}.jsonl`);
    if (p.refine_pid && isAlive(p.refine_pid)) {
      watchRefinement(p.id, p.refine_pid, logPath);
    } else {
      await finalizeRefinement(p.id, logPath);
    }
  }
}
