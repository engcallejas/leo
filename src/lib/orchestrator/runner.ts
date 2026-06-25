import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  assertRunnable,
  buildClaudeEnv,
  resolveProjectExec,
} from "../claude-auth";
import { DATA_DIR, LOGS_DIR, run as dbRun } from "../db";
import { getProvider } from "../integrations";
import {
  cancelRunInteractions,
  createRun,
  getIntegration,
  getProject,
  getRun,
  getTask,
  listRuns,
  setTaskStatus,
  updateRun,
} from "../repo";
import { getSettings } from "../settings";
import { buildSpecContext } from "../specs";
import type { AttachedImage, Project, Run, Task } from "../types";
import {
  buildIterationPrompt,
  buildPrompt,
  iterationFinalizeLine,
  type ChainContext,
} from "./prompt";
import {
  buildAttachmentBlock,
  buildRunExtras,
  mergeAllowedTools,
} from "./run-config";

/** How an iteration should finalize: keep the current PR vs. open a new one. */
export type PrMode = "commit" | "new_pr";

/** Options to continue a previous finished run as its next iteration. */
export interface IterationOpts {
  parentRunId: number;
  /** The human's follow-up ask ("the fix") for this iteration. */
  instruction: string;
  /** When set, resume this exact session so the agent keeps full memory. */
  resumeSessionId?: string;
  /** Fresh-run seed (used when not resuming): a compacted/stored prior summary. */
  seedSummary?: string;
  /** Finalization: commit to the current branch/PR, or open a brand-new PR. */
  prMode: PrMode;
  /** Images the human attached to this iteration (read by the agent via Read). */
  images?: AttachedImage[];
}

// Runs are spawned DETACHED and write their stream-json straight to the log
// file, so they survive a Leo restart. We track them by pid and finalize each
// run by reading the real result from its log — never by the parent process
// lifecycle. On boot we re-attach watchers to any still-running pids.
const globalForRunner = globalThis as unknown as {
  __leoActivePids?: Map<number, number>; // runId -> pid
  __leoWatched?: Set<number>; // runIds with a live watcher
};
const activePids: Map<number, number> =
  globalForRunner.__leoActivePids ?? new Map();
globalForRunner.__leoActivePids = activePids;
const watched: Set<number> = globalForRunner.__leoWatched ?? new Set();
globalForRunner.__leoWatched = watched;

export function activeRunCount(): number {
  return activePids.size;
}

export function stopRun(runId: number): boolean {
  const pid = activePids.get(runId);
  if (!pid) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  return true;
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, not ours
  }
}

function appendLine(logPath: string, obj: unknown): void {
  try {
    fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");
  } catch {
    /* ignore */
  }
}

const ARTIFACT_IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** Upload images the run saved to its artifacts dir as ClickUp attachments. */
async function uploadRunArtifacts(
  task: Task,
  runId: number,
  logPath: string,
): Promise<void> {
  if (!task.integration_id || task.source_type !== "clickup") return;
  const dir = path.join(DATA_DIR, "artifacts", `run-${runId}`);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => ARTIFACT_IMG_RE.test(f));
  } catch {
    return; // no artifacts dir / empty
  }
  if (!files.length) return;
  const integ = await getIntegration(task.integration_id);
  const provider = integ ? getProvider(integ.type) : null;
  if (!integ || !provider?.uploadAttachment) return;
  const config = integ.config as unknown as Record<string, unknown>;
  let n = 0;
  for (const f of files.slice(0, 10)) {
    try {
      const buf = fs.readFileSync(path.join(dir, f));
      const r = await provider.uploadAttachment(config, task.external_id, f, buf);
      if (r.ok) n++;
    } catch {
      /* skip this file */
    }
  }
  if (n) {
    appendLine(logPath, { type: "leo_artifacts", count: n });
    if (provider.addComment) {
      await provider
        .addComment(
          config,
          task.external_id,
          `🦁 Leo adjuntó ${n} imagen(es) del resultado a la tarea.`,
        )
        .catch(() => {});
    }
  }
}

function buildArgs(
  project: Project,
  prompt: string,
  model: string | null,
  allowedTools: string | null,
  extraArgs: string[],
): string[] {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (project.permission_mode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", project.permission_mode);
  }
  if (allowedTools && allowedTools.trim()) {
    args.push("--allowedTools", allowedTools.trim());
  }
  if (project.disallowed_tools && project.disallowed_tools.trim()) {
    args.push("--disallowedTools", project.disallowed_tools.trim());
  }
  if (model && model.trim()) {
    args.push("--model", model.trim());
  }
  if (project.max_turns && project.max_turns > 0) {
    args.push("--max-turns", String(project.max_turns));
  }
  args.push(...extraArgs);
  args.push("--add-dir", project.repo_path);
  return args;
}

interface StreamResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  session_id?: string;
}

/** Scan a run's log file for the final stream-json `result` event. */
function parseFinalResult(logPath: string): StreamResult | null {
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
      if (evt.type === "result") return evt as StreamResult;
    } catch {
      /* skip non-JSON */
    }
  }
  return null;
}

async function failRun(
  runId: number,
  taskId: number,
  logPath: string,
  message: string,
): Promise<Run> {
  appendLine(logPath, { type: "leo_error", message });
  await updateRun(runId, { status: "failed", error: message, finished: true });
  await setTaskStatus(taskId, "failed");
  await cancelRunInteractions(runId).catch(() => {});
  activePids.delete(runId);
  watched.delete(runId);
  return (await getRun(runId))!;
}

/** Finalize a run from its log file. Idempotent and race-safe. */
async function finalizeRun(
  runId: number,
  task: Task,
  project: Project,
  logPath: string,
): Promise<void> {
  const cur = await getRun(runId);
  if (!cur || cur.status !== "running") {
    activePids.delete(runId);
    watched.delete(runId);
    return;
  }

  const result = parseFinalResult(logPath);
  const isError = result ? result.is_error === true : true;
  const status = isError ? "failed" : "done";

  appendLine(logPath, { type: "leo_end", is_error: isError });
  await updateRun(runId, {
    status,
    session_id: result?.session_id ?? undefined,
    num_turns: result?.num_turns ?? null,
    cost_usd: result?.total_cost_usd ?? null,
    duration_ms: result?.duration_ms ?? null,
    result_summary: result?.result ? result.result.slice(0, 4000) : null,
    error: isError
      ? result?.result?.slice(0, 2000) ||
        "El proceso terminó sin un resultado (posible interrupción)."
      : null,
    finished: true,
  });
  await setTaskStatus(task.id, isError ? "failed" : "done");
  await cancelRunInteractions(runId).catch(() => {});

  // On success, attach any result images the run saved to its artifacts dir.
  if (!isError) {
    await uploadRunArtifacts(task, runId, logPath).catch(() => {});
  }

  // Chain child (a ClickUp subtask run): on success move the subtask to
  // 'complete' — the parent is moved separately when the whole chain finishes.
  if (!isError && task.parent_task_id && task.integration_id) {
    try {
      const integ = await getIntegration(task.integration_id);
      const provider = integ ? getProvider(integ.type) : null;
      if (integ && provider?.resolveTask) {
        const r = await provider.resolveTask(
          integ.config as unknown as Record<string, unknown>,
          task.external_id,
          { status: "complete" },
        );
        appendLine(logPath, { type: "leo_resolve", ok: r.ok, message: r.message });
      }
    } catch (e) {
      appendLine(logPath, {
        type: "leo_resolve",
        ok: false,
        message: `Error al completar subtask: ${(e as Error).message}`,
      });
    }
  } else if (
    // On success, optionally resolve the source item (e.g. Sentry issue).
    !isError &&
    project.resolve_source_on_done &&
    task.integration_id &&
    task.source_type !== "manual"
  ) {
    try {
      const integ = await getIntegration(task.integration_id);
      const provider = integ ? getProvider(integ.type) : null;
      if (integ && provider?.resolveTask) {
        // For ClickUp, pass the per-source "estado al completar" target.
        let opts: { status?: string } | undefined;
        if (integ.type === "clickup") {
          const raw = task.raw as { list?: { id?: string } } | null;
          const listId = raw?.list?.id ? String(raw.list.id) : undefined;
          const src =
            project.sources.find(
              (s) =>
                s.type === "clickup" &&
                (!listId || String(s.filter.listId) === listId),
            ) || project.sources.find((s) => s.type === "clickup");
          opts = { status: src?.filter.doneStatus as string | undefined };
        }
        const r = await provider.resolveTask(
          integ.config as unknown as Record<string, unknown>,
          task.external_id,
          opts,
        );
        appendLine(logPath, { type: "leo_resolve", ok: r.ok, message: r.message });
      }
    } catch (e) {
      appendLine(logPath, {
        type: "leo_resolve",
        ok: false,
        message: `Error al resolver el origen: ${(e as Error).message}`,
      });
    }
  }

  activePids.delete(runId);
  watched.delete(runId);
}

/** Poll a detached pid; when it exits, finalize from the log. */
function watchRun(
  runId: number,
  pid: number,
  task: Task,
  project: Project,
  logPath: string,
): void {
  if (watched.has(runId)) return;
  watched.add(runId);
  activePids.set(runId, pid);
  const tick = () => {
    if (!watched.has(runId)) return;
    if (isAlive(pid)) {
      setTimeout(tick, 2000);
      return;
    }
    void finalizeRun(runId, task, project, logPath).catch(() => {});
  };
  setTimeout(tick, 2000);
}

/** True if a resumable transcript for this session id still exists on disk. */
function sessionTranscriptExists(sessionId: string): boolean {
  if (!sessionId) return false;
  try {
    const base = path.join(os.homedir(), ".claude", "projects");
    for (const dir of fs.readdirSync(base)) {
      if (fs.existsSync(path.join(base, dir, `${sessionId}.jsonl`))) return true;
    }
  } catch {
    /* ~/.claude/projects missing or unreadable */
  }
  return false;
}

const COMPACT_PROMPT =
  "Compacta esta conversación en un resumen de estado para que otro agente " +
  "continúe el trabajo SIN leer todo el historial. Incluye, de forma concisa: " +
  "(1) qué se implementó y los archivos/áreas tocadas; (2) la branch de trabajo " +
  "y el PR (número/URL) si se abrió; (3) decisiones y supuestos clave; (4) qué " +
  "quedó pendiente, fallando o sin verificar; (5) cómo correr las validaciones/" +
  "tests relevantes. NO uses herramientas; responde solo con el resumen en markdown.";

/**
 * Distill a finished run's session into a tight status summary by resuming it in
 * a forked, read-only, single-turn pass. Used by the "compactar antes" option so
 * the next iteration starts fresh from the summary instead of dragging the full
 * (possibly huge) transcript. Best-effort: returns null on any failure/timeout.
 */
export async function compactSession(
  project: Project,
  sessionId: string,
): Promise<string | null> {
  const gate = await assertRunnable(project);
  if (!gate.ok) return null;
  const exec = await resolveProjectExec(project);
  const settings = await getSettings();
  const env = await buildClaudeEnv({ method: exec.method, apiKey: exec.apiKey });
  const args = [
    "-p",
    COMPACT_PROMPT,
    "--resume",
    sessionId,
    "--fork-session",
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--disallowedTools",
    "Edit,MultiEdit,Write,NotebookEdit,Bash",
  ];
  if (exec.model && exec.model.trim()) args.push("--model", exec.model.trim());

  return await new Promise<string | null>((resolve) => {
    let out = "";
    let child: ChildProcess;
    try {
      child = spawn(settings.claude_binary_path, args, {
        cwd: project.repo_path,
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      resolve(null);
    }, 180_000);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as { result?: unknown; is_error?: boolean };
        const text = typeof j.result === "string" ? j.result.trim() : "";
        resolve(text || null);
      } catch {
        resolve(out.trim() || null);
      }
    });
  });
}

export async function startRun(
  task: Task,
  project: Project,
  chain?: ChainContext,
  iteration?: IterationOpts,
): Promise<Run> {
  const settings = await getSettings();

  const runRow = await createRun({
    task_id: task.id,
    project_id: project.id,
    log_path: path.join(LOGS_DIR, "pending.jsonl"),
    parent_run_id: iteration?.parentRunId ?? null,
  });
  const logPath = path.join(LOGS_DIR, `run-${runRow.id}.jsonl`);
  fs.writeFileSync(logPath, "");
  await dbRun("UPDATE runs SET log_path = ? WHERE id = ?", [logPath, runRow.id]);

  // Guard: repo must exist.
  if (
    !fs.existsSync(project.repo_path) ||
    !fs.statSync(project.repo_path).isDirectory()
  ) {
    return failRun(
      runRow.id,
      task.id,
      logPath,
      `Repo path no existe o no es un directorio: ${project.repo_path}`,
    );
  }

  // Gate: the project's effective auth (subscription or API key) must be ready.
  const gate = await assertRunnable(project);
  if (!gate.ok) {
    return failRun(runRow.id, task.id, logPath, gate.reason ?? "No ejecutable");
  }
  const exec = await resolveProjectExec(project);

  // Enrich the prompt with fresh source context (ClickUp description, comments,
  // attachments/images, etc.). Best-effort — never blocks the run.
  let extraContext = "";
  if (task.integration_id && task.source_type !== "manual") {
    try {
      const integ = await getIntegration(task.integration_id);
      const provider = integ ? getProvider(integ.type) : null;
      if (integ && provider?.fetchTaskContext) {
        extraContext = await provider.fetchTaskContext(
          integ.config as unknown as Record<string, unknown>,
          task.external_id,
        );
      }
    } catch {
      /* best-effort context */
    }
  }

  // Requirement docs (SDD/AIDLC) injected as ground-truth context.
  const specContext = buildSpecContext(project, true);
  const interactiveNote = project.interactive
    ? `\n\n## Preguntas al humano\nSi el requerimiento es ambiguo o un paso necesita aprobación, NO asumas: usa la tool \`mcp__leo__ask_user\` (o \`mcp__leo__request_approval\` para aprobar/rechazar una acción) y espera la respuesta antes de continuar.`
    : "";

  // Per-run artifacts dir: the agent saves screenshots/result images here, and
  // Leo attaches them to the ClickUp task on success. Granted via --add-dir.
  const artifactsDir = path.join(DATA_DIR, "artifacts", `run-${runRow.id}`);
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const artifactNote =
    task.source_type === "clickup"
      ? `\n\n## Capturas para ClickUp\nSi generas screenshots/capturas (p. ej. en la verificación visual), guárdalas como archivos de imagen en "${artifactsDir}". Leo las adjuntará automáticamente a la tarea de ClickUp al terminar con éxito.`
      : "";

  // Images the human attached to an iteration (read by the agent via Read).
  const iterAttachBlock = iteration
    ? buildAttachmentBlock(
        iteration.images ?? [],
        "## Imágenes adjuntas a esta iteración",
      )
    : "";

  let prompt: string;
  if (iteration?.resumeSessionId) {
    // Resume: the agent already remembers everything — keep the turn lean.
    prompt = `${buildIterationPrompt(
      project,
      task,
      iteration.instruction,
      iteration.parentRunId,
      iteration.prMode,
      iterAttachBlock,
    )}${interactiveNote}${artifactNote}`;
  } else {
    // Fresh run (incl. compacted iterations): give full task context, plus the
    // prior summary + the requested adjustment when this is an iteration.
    let ctx = extraContext;
    let iterAjuste = "";
    if (iteration) {
      const prior = iteration.seedSummary?.trim()
        ? `### Estado del trabajo anterior (run #${iteration.parentRunId}, resumen)\n${iteration.seedSummary.trim()}`
        : `Esta es una continuación del run #${iteration.parentRunId}.`;
      ctx = [extraContext, prior].filter(Boolean).join("\n\n");
      iterAjuste = `\n\n## Ajuste pedido en esta iteración (PRIORITARIO)\n${
        iteration.instruction.trim() ||
        "(sin instrucción — revisa y mejora lo pendiente del run anterior)"
      }${iterAttachBlock ? `\n\n${iterAttachBlock}` : ""}\n\nAplica solo este ajuste, construyendo sobre lo ya hecho.\n${iterationFinalizeLine(
        iteration.prMode,
      )}`;
    }
    const basePrompt = buildPrompt(project, task, ctx, chain);
    prompt = `${basePrompt}${specContext ? `\n\n${specContext}` : ""}${interactiveNote}${artifactNote}${iterAjuste}`;
  }

  // Per-run MCP servers (dev scope) + hooks settings + the Leo ask_user MCP
  // when this project is interactive.
  const extras = buildRunExtras({
    project,
    scope: "development",
    baseName: `run-${runRow.id}`,
    interactiveRunId: runRow.id,
  });
  const allowedTools = mergeAllowedTools(
    project.allowed_tools,
    extras.allowedMcpTools,
  );
  // Resume the prior session (forked so the original stays intact and this run
  // gets its own session id for further iterations).
  const iterArgs = iteration?.resumeSessionId
    ? ["--resume", iteration.resumeSessionId, "--fork-session"]
    : [];
  const args = buildArgs(project, prompt, exec.model, allowedTools, [
    ...extras.args,
    ...iterArgs,
    "--add-dir",
    artifactsDir,
  ]);
  appendLine(logPath, {
    type: "leo_start",
    bin: settings.claude_binary_path,
    cwd: project.repo_path,
    permission_mode: project.permission_mode,
    auth_method: exec.method,
    model: exec.model,
    mcp: extras.allowedMcpTools,
    ...(iteration
      ? {
          iteration_of: iteration.parentRunId,
          resumed: !!iteration.resumeSessionId,
        }
      : {}),
    prompt,
  });

  // Spawn detached, streaming stdout+stderr straight to the log file so the run
  // survives a Leo restart.
  let child: ChildProcess;
  let out: number;
  try {
    out = fs.openSync(logPath, "a");
  } catch (e) {
    return failRun(
      runRow.id,
      task.id,
      logPath,
      `No se pudo abrir el log: ${(e as Error).message}`,
    );
  }
  try {
    child = spawn(settings.claude_binary_path, args, {
      cwd: project.repo_path,
      env: await buildClaudeEnv({ method: exec.method, apiKey: exec.apiKey }),
      detached: true,
      stdio: ["ignore", out, out],
    });
  } catch (e) {
    fs.closeSync(out);
    return failRun(
      runRow.id,
      task.id,
      logPath,
      `No se pudo lanzar claude: ${(e as Error).message}`,
    );
  }
  fs.closeSync(out); // child keeps its own inherited fd

  if (!child.pid) {
    return failRun(
      runRow.id,
      task.id,
      logPath,
      "No se pudo lanzar claude (sin pid). Revisa la ruta del binario en Ajustes.",
    );
  }

  child.once("error", (err) => {
    appendLine(logPath, {
      type: "leo_error",
      message: `Error de proceso: ${err.message}`,
    });
  });
  child.unref();

  await updateRun(runRow.id, { pid: child.pid });
  watchRun(runRow.id, child.pid, task, project, logPath);

  return (await getRun(runRow.id))!;
}

/**
 * Continue a FINISHED run as its next iteration. By default it resumes the exact
 * Claude session (full memory) and applies the human's follow-up. With
 * `compact`, it first distills the session into a summary and starts fresh from
 * it (lighter context). If the session transcript is gone, it falls back to a
 * fresh run seeded with the stored result summary.
 */
export async function iterateRun(
  parentRunId: number,
  instruction: string,
  opts: { compact?: boolean; prMode?: PrMode; images?: AttachedImage[] } = {},
): Promise<Run> {
  const parent = await getRun(parentRunId);
  if (!parent) throw new Error("Run no encontrado.");
  if (parent.status === "running") {
    throw new Error("El run aún está en ejecución; espera a que termine para iterar.");
  }
  const task = await getTask(parent.task_id);
  const project = await getProject(parent.project_id);
  if (!task || !project) {
    throw new Error("La tarea o el proyecto de este run ya no existe.");
  }

  const canResume =
    !!parent.session_id && sessionTranscriptExists(parent.session_id);
  const base = {
    parentRunId,
    instruction,
    prMode: opts.prMode ?? "commit",
    images: opts.images ?? [],
  };

  // Reflect that the task is being worked on again until the new run finalizes.
  await setTaskStatus(task.id, "running").catch(() => {});

  if (canResume && opts.compact) {
    const summary = await compactSession(project, parent.session_id!);
    return startRun(task, project, undefined, {
      ...base,
      seedSummary: summary ?? parent.result_summary ?? "",
    });
  }
  if (canResume) {
    return startRun(task, project, undefined, {
      ...base,
      resumeSessionId: parent.session_id!,
    });
  }
  // Session gone → fresh run seeded with whatever summary we stored.
  return startRun(task, project, undefined, {
    ...base,
    seedSummary: parent.result_summary ?? "",
  });
}

/**
 * On boot, reconcile runs left "running": re-attach a watcher if the detached
 * process is still alive, otherwise finalize from the log (recovering the real
 * result instead of blindly marking them failed).
 */
export async function reconcileRunningRuns(): Promise<void> {
  const runs = await listRuns({ status: "running", limit: 1000 });
  for (const r of runs) {
    const task = await getTask(r.task_id);
    const project = await getProject(r.project_id);
    if (!task || !project) {
      await updateRun(r.id, {
        status: "failed",
        error: "Proyecto o tarea ya no existe.",
        finished: true,
      });
      continue;
    }
    if (r.pid && isAlive(r.pid)) {
      watchRun(r.id, r.pid, task, project, r.log_path);
    } else {
      await finalizeRun(r.id, task, project, r.log_path);
    }
  }
}
