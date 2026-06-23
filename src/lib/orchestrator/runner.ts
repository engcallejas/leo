import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { buildClaudeEnv, getAuthStatus } from "../claude-auth";
import { LOGS_DIR, run as dbRun } from "../db";
import { getProvider } from "../integrations";
import {
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
import type { Project, Run, Task } from "../types";
import { buildPrompt } from "./prompt";

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

function buildArgs(project: Project, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
  if (project.permission_mode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", project.permission_mode);
  }
  if (project.allowed_tools && project.allowed_tools.trim()) {
    args.push("--allowedTools", project.allowed_tools.trim());
  }
  if (project.disallowed_tools && project.disallowed_tools.trim()) {
    args.push("--disallowedTools", project.disallowed_tools.trim());
  }
  if (project.model && project.model.trim()) {
    args.push("--model", project.model.trim());
  }
  if (project.max_turns && project.max_turns > 0) {
    args.push("--max-turns", String(project.max_turns));
  }
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

  // On success, optionally resolve the source item (e.g. Sentry issue).
  if (
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

export async function startRun(task: Task, project: Project): Promise<Run> {
  const settings = await getSettings();

  const runRow = await createRun({
    task_id: task.id,
    project_id: project.id,
    log_path: path.join(LOGS_DIR, "pending.jsonl"),
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

  // Gate: only run with an active Claude subscription (never API key).
  const auth = await getAuthStatus();
  if (!auth.authenticated) {
    const msg = auth.loggedIn
      ? "Claude está autenticado por API key/consola, no por suscripción. Inicia sesión con tu suscripción (claude auth login) o configura CLAUDE_CODE_OAUTH_TOKEN."
      : `No autenticado con una suscripción de Claude. ${auth.error ?? "Ejecuta `claude setup-token` y pega el token en Ajustes."}`;
    return failRun(runRow.id, task.id, logPath, msg);
  }

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

  const prompt = buildPrompt(project, task, extraContext);
  const args = buildArgs(project, prompt);
  appendLine(logPath, {
    type: "leo_start",
    bin: settings.claude_binary_path,
    cwd: project.repo_path,
    permission_mode: project.permission_mode,
    model: project.model ?? null,
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
      env: await buildClaudeEnv(),
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
