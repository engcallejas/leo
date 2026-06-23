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
import { getPlan, listPlans, replaceSteps, updatePlan } from "../plan-repo";
import { getIntegration, getProject } from "../repo";
import { getSettings } from "../settings";
import type { Plan, Project, RefineResult } from "../types";

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

function buildRefinePrompt(
  project: Project,
  plan: Plan,
  seedContext: string,
): string {
  const sourceLabel =
    plan.source_type === "manual"
      ? "manual"
      : plan.source_type.charAt(0).toUpperCase() + plan.source_type.slice(1);

  const sections: string[] = [
    `You are a senior engineer and product analyst doing REQUIREMENTS REFINEMENT for the "${project.name}" repository.`,
    `You are STRICTLY READ-ONLY: do NOT modify files, do NOT run commands that change state, do NOT commit or push. Use Read/Grep/Glob to inspect the codebase so your plan is grounded in how this project actually works (its CLAUDE.md, conventions, modules, and validations).`,
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

  sections.push(
    `\n## Your job`,
    `1. Investigate the relevant parts of the codebase to ground the work in reality (which files/modules change, existing patterns, the validations that must pass).`,
    `2. Produce a precise, unambiguous refined requirement that removes guesswork for the implementing agent.`,
    `3. Break it into an ORDERED list of independently-executable steps (subtasks). Each step is a self-contained unit a coding agent completes in one session; later steps may build on earlier ones. Prefer 2–6 steps unless the work is trivial (then 1) or genuinely large.`,
    `   For each step give a short imperative title and a DETAILED spec: what to change, where (files/modules), acceptance criteria, and which validations/tests to run.`,
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
): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    // Hard block any state-changing tool so a read-only refinement can never
    // edit the repo or hang on a permission prompt without a TTY.
    "--disallowedTools",
    "Edit,MultiEdit,Write,NotebookEdit,Bash",
    "--max-turns",
    "40",
  ];
  if (model && model.trim()) args.push("--model", model.trim());
  args.push("--add-dir", project.repo_path);
  return args;
}

/** Extract the last fenced ```json block (or last balanced object) from text. */
export function extractRefineJson(text: string): RefineResult | null {
  if (!text) return null;
  const candidates: string[] = [];
  const fence = /```json\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) candidates.push(m[1]);
  // Fallback: any fenced block, then a raw balanced object.
  if (candidates.length === 0) {
    const anyFence = /```\s*([\s\S]*?)```/gi;
    while ((m = anyFence.exec(text)) !== null) candidates.push(m[1]);
  }
  if (candidates.length === 0) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(candidates[i].trim()) as Partial<RefineResult>;
      if (obj && Array.isArray(obj.steps)) {
        return {
          title: typeof obj.title === "string" ? obj.title : undefined,
          refined_spec:
            typeof obj.refined_spec === "string" ? obj.refined_spec : "",
          steps: obj.steps
            .filter((s) => s && typeof s.title === "string")
            .map((s) => ({ title: s.title, spec: String(s.spec ?? "") })),
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

  const result = parseFinalResult(logPath);
  const parsed = result?.result ? extractRefineJson(result.result) : null;

  if (!parsed || parsed.steps.length === 0) {
    appendLine(logPath, { type: "leo_refine_error" });
    await updatePlan(planId, {
      status: "failed",
      refine_pid: null,
      error:
        result?.is_error === true
          ? "El refinamiento terminó con error (revisa el log)."
          : "No se pudo extraer un plan estructurado del resultado del refinamiento.",
    });
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

/** Kick off a refinement run for a plan. Returns the updated plan. */
export async function startRefinement(planId: number): Promise<Plan> {
  const plan = await getPlan(planId);
  if (!plan) throw new Error("Plan no encontrado");
  if (plan.status === "refining" || refinePids.has(planId)) return plan;

  const project = await getProject(plan.project_id);
  if (!project) throw new Error("Proyecto no encontrado");

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

  const settings = await getSettings();
  const exec = await resolveProjectExec(project);
  const seedContext = await fetchSeedContext(plan);
  const prompt = buildRefinePrompt(project, plan, seedContext);
  const args = buildRefineArgs(project, prompt, exec.model);

  const logPath = path.join(LOGS_DIR, `plan-refine-${planId}.jsonl`);
  fs.writeFileSync(logPath, "");
  appendLine(logPath, {
    type: "leo_refine_start",
    cwd: project.repo_path,
    auth_method: exec.method,
    model: exec.model,
    prompt,
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
      env: await buildClaudeEnv({ method: exec.method, apiKey: exec.apiKey }),
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
