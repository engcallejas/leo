import { assertRunnable } from "../claude-auth";
import { getProvider } from "../integrations";
import {
  claimTaskForRun,
  getProject,
  getTask,
  listIntegrations,
  listProjects,
  listRuns,
  listTasks,
  queueTask,
  setIntegrationPollResult,
  setTaskStatus,
  upsertTask,
} from "../repo";
import { getSettings } from "../settings";
import type { Project, Run } from "../types";
import { planTick } from "./plan-runner";
import { reconcileRefinements } from "./planner";
import { activeRunCount, reconcileRunningRuns, startRun } from "./runner";

const globalForSched = globalThis as unknown as {
  __leoScheduler?: {
    started: boolean;
    timer: NodeJS.Timeout | null;
    lastTickAt: string | null;
    lastError: string | null;
  };
};

const state =
  globalForSched.__leoScheduler ??
  (globalForSched.__leoScheduler = {
    started: false,
    timer: null,
    lastTickAt: null,
    lastError: null,
  });

export function schedulerStatus() {
  return {
    started: state.started,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    activeRuns: activeRunCount(),
  };
}

/** Poll every project's source bindings and upsert tasks. */
async function pollAll(): Promise<{ sourcesPolled: number }> {
  const [projects, integrations] = await Promise.all([
    listProjects(),
    listIntegrations(),
  ]);
  const intById = new Map(integrations.map((i) => [i.id, i]));
  const errorByIntegration = new Map<number, string | null>();
  const polled = new Set<number>();
  let sourcesPolled = 0;

  for (const proj of projects) {
    if (!proj.enabled) continue;
    for (const src of proj.sources) {
      const integ = intById.get(src.integration_id);
      if (!integ || !integ.enabled) continue;
      sourcesPolled++;
      polled.add(integ.id);
      try {
        const items = await getProvider(integ.type).poll(
          integ.config as unknown as Record<string, unknown>,
          src.filter,
        );
        for (const it of items) {
          await upsertTask({
            project_id: proj.id,
            integration_id: integ.id,
            source_type: integ.type,
            external_id: it.external_id,
            title: it.title,
            description: it.description,
            url: it.url,
            raw: it.raw,
          });
        }
        if (!errorByIntegration.has(integ.id))
          errorByIntegration.set(integ.id, null);
      } catch (e) {
        errorByIntegration.set(integ.id, (e as Error).message);
      }
    }
  }

  for (const id of polled) {
    await setIntegrationPollResult(id, errorByIntegration.get(id) ?? null);
  }
  return { sourcesPolled };
}

/** Start runs for eligible tasks, bounded by max_concurrent_runs. */
async function enqueueDue(): Promise<number> {
  const settings = await getSettings();
  const max = settings.max_concurrent_runs;
  if (activeRunCount() >= max) return 0;

  const projects = await listProjects();
  const projById = new Map(projects.map((p) => [p.id, p]));

  // Per-project sequential: never run two runs for the same project/repo at
  // once (avoids git working-tree conflicts; makes a project's tasks run
  // one-by-one).
  const runningRuns = await listRuns({ status: "running", limit: 1000 });
  const busyProjects = new Set(runningRuns.map((r) => r.project_id));
  const now = Date.now();
  const due = (iso: string | null) =>
    !iso || new Date(iso).getTime() <= now;

  let started = 0;
  const tryStart = async (taskId: number, proj: Project) => {
    if (activeRunCount() >= max) return;
    if (busyProjects.has(proj.id)) return; // sequential per project
    const gate = await assertRunnable(proj);
    if (!gate.ok) {
      state.lastError = gate.reason ?? "Proyecto no ejecutable";
      return;
    }
    if (await claimTaskForRun(taskId)) {
      busyProjects.add(proj.id);
      await safeStart(taskId, proj.id);
      started++;
    }
  };

  // 1) Explicitly queued tasks (user pressed Encolar/Run) — any project.
  const queued = await listTasks({ status: "queued", limit: 200 });
  for (const t of queued) {
    if (activeRunCount() >= max) break;
    const proj = projById.get(t.project_id);
    if (!proj || !proj.enabled || !due(t.scheduled_for)) continue;
    await tryStart(t.id, proj);
  }

  // 2) Auto-mode pending tasks — only when the global switch is on.
  if (settings.auto_run_enabled) {
    const pending = await listTasks({ status: "pending", limit: 200 });
    for (const t of pending) {
      if (activeRunCount() >= max) break;
      const proj = projById.get(t.project_id);
      if (!proj || !proj.enabled || !proj.auto_mode || !due(t.scheduled_for))
        continue;
      await tryStart(t.id, proj);
    }
  }
  return started;
}

async function safeStart(taskId: number, projectId: number): Promise<void> {
  const task = await getTask(taskId);
  const project = await getProject(projectId);
  if (!task || !project) return;
  try {
    await startRun(task, project);
  } catch (e) {
    await setTaskStatus(taskId, "failed");
    state.lastError = `startRun: ${(e as Error).message}`;
  }
}

async function tick(): Promise<{ sourcesPolled: number; started: number }> {
  const poll = await pollAll().catch((e) => {
    state.lastError = `pollAll: ${(e as Error).message}`;
    return { sourcesPolled: 0 };
  });
  // Advance plan orchestration before enqueueDue so freshly-dispatched step
  // tasks (status 'queued') get started in the same tick.
  await planTick().catch((e) => {
    state.lastError = `planTick: ${(e as Error).message}`;
  });
  const started = await enqueueDue().catch((e) => {
    state.lastError = `enqueue: ${(e as Error).message}`;
    return 0;
  });
  state.lastTickAt = new Date().toISOString();
  return { sourcesPolled: poll.sourcesPolled, started };
}

/** Manual full cycle from the UI. Returns a small summary. */
export async function pollNow(): Promise<{
  sourcesPolled: number;
  started: number;
  pending: number;
}> {
  const poll = await pollAll();
  await planTick().catch(() => {});
  const started = await enqueueDue();
  state.lastTickAt = new Date().toISOString();
  const pendingTasks = await listTasks({ status: "pending", limit: 1000 });
  const queuedTasks = await listTasks({ status: "queued", limit: 1000 });
  return {
    sourcesPolled: poll.sourcesPolled,
    started,
    pending: pendingTasks.length + queuedTasks.length,
  };
}

/** Run (or queue) a single task on demand, ignoring auto_mode. */
export async function startTaskRun(taskId: number): Promise<{
  started: boolean;
  queued: boolean;
  run?: Run;
  reason?: string;
}> {
  const task = await getTask(taskId);
  if (!task) return { started: false, queued: false, reason: "Task not found" };
  const project = await getProject(task.project_id);
  if (!project)
    return { started: false, queued: false, reason: "Project not found" };
  if (!project.enabled)
    return { started: false, queued: false, reason: "Proyecto deshabilitado" };

  const gate = await assertRunnable(project);
  if (!gate.ok) {
    return { started: false, queued: false, reason: gate.reason };
  }

  const settings = await getSettings();
  const projectBusy =
    (await listRuns({ status: "running", project_id: project.id, limit: 1 }))
      .length > 0;
  // No free global slot, or this project is already running → queue it (runs
  // ASAP, in order). Clear any schedule since the user asked to run it now.
  if (activeRunCount() >= settings.max_concurrent_runs || projectBusy) {
    await queueTask(taskId, null);
    return { started: false, queued: true };
  }
  if (await claimTaskForRun(taskId)) {
    const run = await startRun(task, project);
    return { started: true, queued: false, run };
  }
  return { started: false, queued: false, reason: "No se pudo reclamar la tarea" };
}

async function loop(): Promise<void> {
  try {
    await tick();
  } catch (e) {
    state.lastError = (e as Error).message;
  } finally {
    const settings = await getSettings().catch(() => ({
      poll_interval_seconds: 60,
    }));
    state.timer = setTimeout(
      loop,
      Math.max(5, settings.poll_interval_seconds) * 1000,
    );
  }
}

/** Boot the scheduler once per process. Safe to call multiple times. */
export async function ensureScheduler(): Promise<void> {
  if (state.started) return;
  state.started = true;
  await reconcileRunningRuns().catch(() => {});
  await reconcileRefinements().catch(() => {});
  // First tick shortly after boot, then self-schedule.
  state.timer = setTimeout(loop, 2000);
}
