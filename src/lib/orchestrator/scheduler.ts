import fs from "fs";
import { listAccounts } from "../account-repo";
import { assertRunnable } from "../claude-auth";
import { getProvider } from "../integrations";
import {
  claimTaskForRun,
  clearRunWorktreePath,
  getProject,
  getResolvedProject,
  getTask,
  listIntegrations,
  listProjects,
  listRuns,
  listStaleWorktreeRuns,
  listTasks,
  prunePendingSourceTasks,
  queueTask,
  setIntegrationPollResult,
  setTaskStatus,
  upsertTask,
} from "../repo";
import { getSettings } from "../settings";
import type { AppSettings, IntegrationType, Project, Run } from "../types";
import { chainTick, startTaskOrChain } from "./chain-runner";
import { planTick } from "./plan-runner";
import { reconcileRefinements } from "./planner";
import { activeRunCount, reconcileRunningRuns } from "./runner";
import { removeRunWorktree } from "./worktree";

// Isolated worktrees are kept for inspection/resume, then garbage-collected once
// their run finished more than this many days ago.
const WORKTREE_TTL_DAYS = 15;
const WORKTREE_GC_INTERVAL_MS = 60 * 60 * 1000; // sweep at most hourly

/** Remove worktrees whose run finished > WORKTREE_TTL_DAYS ago; forget the path. */
async function gcWorktrees(): Promise<void> {
  const stale = await listStaleWorktreeRuns(WORKTREE_TTL_DAYS);
  for (const s of stale) {
    const proj = await getProject(s.project_id);
    if (proj) {
      removeRunWorktree(proj.repo_path, s.worktree_path);
    } else {
      try {
        fs.rmSync(s.worktree_path, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    await clearRunWorktreePath(s.id).catch(() => {});
  }
}

const globalForSched = globalThis as unknown as {
  __leoScheduler?: {
    started: boolean;
    timer: NodeJS.Timeout | null;
    lastTickAt: string | null;
    lastError: string | null;
    lastWorktreeGcAt: number;
  };
};

const state =
  globalForSched.__leoScheduler ??
  (globalForSched.__leoScheduler = {
    started: false,
    timer: null,
    lastTickAt: null,
    lastError: null,
    lastWorktreeGcAt: 0,
  });

export function schedulerStatus() {
  return {
    started: state.started,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    activeRuns: activeRunCount(),
  };
}

/**
 * Poll every project's source bindings and upsert tasks. Pruning (deleting local
 * inbox tasks that vanished from the source) is OFF by default and only happens
 * on an explicit manual sync — never on the silent background tick — and never
 * when a source came back empty, so a transient hiccup can't wipe the inbox.
 */
async function pollAll(
  opts: { prune?: boolean } = {},
): Promise<{ sourcesPolled: number; pruned: number }> {
  const [projects, integrations] = await Promise.all([
    listProjects(),
    listIntegrations(),
  ]);
  const intById = new Map(integrations.map((i) => [i.id, i]));
  const errorByIntegration = new Map<number, string | null>();
  const polled = new Set<number>();
  // Which external ids each (project, integration) still returns — so we can
  // prune local inbox tasks that vanished from the source.
  const returned = new Map<
    string,
    {
      projectId: number;
      integrationId: number;
      sourceType: IntegrationType;
      ids: Set<string>;
    }
  >();
  let sourcesPolled = 0;

  for (const proj of projects) {
    if (!proj.enabled) continue;
    for (const src of proj.sources) {
      const integ = intById.get(src.integration_id);
      if (!integ || !integ.enabled) continue;
      sourcesPolled++;
      polled.add(integ.id);
      const pairKey = `${proj.id}:${integ.id}`;
      let pair = returned.get(pairKey);
      if (!pair) {
        pair = {
          projectId: proj.id,
          integrationId: integ.id,
          sourceType: integ.type,
          ids: new Set(),
        };
        returned.set(pairKey, pair);
      }
      try {
        const items = await getProvider(integ.type).poll(
          integ.config as unknown as Record<string, unknown>,
          src.filter,
        );
        for (const it of items) {
          pair.ids.add(it.external_id);
          await upsertTask({
            project_id: proj.id,
            integration_id: integ.id,
            source_type: integ.type,
            external_id: it.external_id,
            title: it.title,
            description: it.description,
            url: it.url,
            raw: it.raw,
            source_role: src.role ?? "development",
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

  // Prune inbox tasks that disappeared from the source — only on an explicit
  // manual sync, only for integrations that polled cleanly, and only when the
  // source returned at least one item (an empty result must never wipe the inbox).
  let pruned = 0;
  if (opts.prune) {
    for (const pair of returned.values()) {
      if (errorByIntegration.get(pair.integrationId)) continue;
      if (pair.ids.size === 0) continue;
      pruned += await prunePendingSourceTasks(
        pair.projectId,
        pair.integrationId,
        pair.sourceType,
        [...pair.ids],
      );
    }
  }
  return { sourcesPolled, pruned };
}

/**
 * Start runs for eligible tasks. Concurrency is capped PER ACCOUNT (each
 * account has its own max_concurrent_runs and auto_run switch), so accounts run
 * independently — one account being busy never starves another. Per-project
 * sequentiality still holds (no two runs for the same repo at once).
 */
async function enqueueDue(): Promise<number> {
  const accounts = await listAccounts();
  const settingsByAccount = new Map<number, AppSettings>();
  for (const a of accounts) settingsByAccount.set(a.id, await getSettings(a.id));
  const maxFor = (acc: number) =>
    settingsByAccount.get(acc)?.max_concurrent_runs ?? 2;
  const autoFor = (acc: number) =>
    settingsByAccount.get(acc)?.auto_run_enabled ?? false;

  const projects = await listProjects();
  const projById = new Map(projects.map((p) => [p.id, p]));

  // Running runs → per-project sequential (busyProjects) + per-account active
  // counts (so each account is capped by its own max_concurrent_runs).
  const runningRuns = await listRuns({ status: "running", limit: 1000 });
  const busyProjects = new Set(runningRuns.map((r) => r.project_id));
  const active = new Map<number, number>(); // accountId -> running run count
  for (const r of runningRuns) {
    const acc = projById.get(r.project_id)?.account_id;
    if (acc != null) active.set(acc, (active.get(acc) ?? 0) + 1);
  }
  const now = Date.now();
  const due = (iso: string | null) =>
    !iso || new Date(iso).getTime() <= now;

  let started = 0;
  const tryStart = async (taskId: number, proj: Project) => {
    const acc = proj.account_id;
    if ((active.get(acc) ?? 0) >= maxFor(acc)) return; // account at capacity
    if (busyProjects.has(proj.id)) return; // sequential per project
    const gate = await assertRunnable(proj);
    if (!gate.ok) {
      state.lastError = gate.reason ?? "Proyecto no ejecutable";
      return;
    }
    if (await claimTaskForRun(taskId)) {
      busyProjects.add(proj.id);
      active.set(acc, (active.get(acc) ?? 0) + 1);
      await safeStart(taskId, proj.id);
      started++;
    }
  };

  // 1) Explicitly queued tasks (user pressed Encolar/Run) — any project.
  const queued = await listTasks({ status: "queued", limit: 200 });
  for (const t of queued) {
    if (t.parent_task_id) continue; // chain children are managed by chainTick
    const proj = projById.get(t.project_id);
    if (!proj || !proj.enabled || !due(t.scheduled_for)) continue;
    await tryStart(t.id, proj);
  }

  // 2) Auto-mode pending tasks — only for accounts whose auto-run switch is on.
  // Tasks pulled from a planning-only source are never auto-run (plan picker).
  const pending = await listTasks({ status: "pending", limit: 200 });
  for (const t of pending) {
    if (t.source_role === "planning") continue;
    if (t.parent_task_id) continue; // chain children are managed by chainTick
    const proj = projById.get(t.project_id);
    if (!proj || !proj.enabled || !proj.auto_mode || !due(t.scheduled_for))
      continue;
    if (!autoFor(proj.account_id)) continue; // account's auto-run is off
    await tryStart(t.id, proj);
  }
  return started;
}

async function safeStart(taskId: number, projectId: number): Promise<void> {
  const task = await getTask(taskId);
  const project = await getResolvedProject(projectId);
  if (!task || !project) return;
  try {
    await startTaskOrChain(task, project);
  } catch (e) {
    await setTaskStatus(taskId, "failed");
    state.lastError = `startRun: ${(e as Error).message}`;
  }
}

async function tick(): Promise<{ sourcesPolled: number; started: number }> {
  const poll = await pollAll().catch((e) => {
    state.lastError = `pollAll: ${(e as Error).message}`;
    return { sourcesPolled: 0, pruned: 0 };
  });
  // Advance plan orchestration before enqueueDue so freshly-dispatched step
  // tasks (status 'queued') get started in the same tick.
  await planTick().catch((e) => {
    state.lastError = `planTick: ${(e as Error).message}`;
  });
  // Advance ClickUp subtask chains (one run per subtask on a shared branch).
  await chainTick().catch((e) => {
    state.lastError = `chainTick: ${(e as Error).message}`;
  });
  const started = await enqueueDue().catch((e) => {
    state.lastError = `enqueue: ${(e as Error).message}`;
    return 0;
  });
  // Sweep stale worktrees at most hourly (cheap DB check, no-op most ticks).
  const now = Date.now();
  if (now - state.lastWorktreeGcAt >= WORKTREE_GC_INTERVAL_MS) {
    state.lastWorktreeGcAt = now;
    await gcWorktrees().catch((e) => {
      state.lastError = `gcWorktrees: ${(e as Error).message}`;
    });
  }
  state.lastTickAt = new Date().toISOString();
  return { sourcesPolled: poll.sourcesPolled, started };
}

/** Manual full cycle from the UI. Returns a small summary. */
export async function pollNow(): Promise<{
  sourcesPolled: number;
  started: number;
  pending: number;
  pruned: number;
}> {
  const poll = await pollAll({ prune: true });
  await planTick().catch(() => {});
  await chainTick().catch(() => {});
  const started = await enqueueDue();
  state.lastTickAt = new Date().toISOString();
  const pendingTasks = await listTasks({ status: "pending", limit: 1000 });
  const queuedTasks = await listTasks({ status: "queued", limit: 1000 });
  return {
    sourcesPolled: poll.sourcesPolled,
    started,
    pending: pendingTasks.length + queuedTasks.length,
    pruned: poll.pruned,
  };
}

/** Run (or queue) a single task on demand, ignoring auto_mode. */
export async function startTaskRun(
  taskId: number,
  opts?: { worktree?: boolean },
): Promise<{
  started: boolean;
  queued: boolean;
  run?: Run;
  reason?: string;
}> {
  const task = await getTask(taskId);
  if (!task) return { started: false, queued: false, reason: "Task not found" };
  const project = await getResolvedProject(task.project_id);
  if (!project)
    return { started: false, queued: false, reason: "Project not found" };
  if (!project.enabled)
    return { started: false, queued: false, reason: "Proyecto deshabilitado" };

  const gate = await assertRunnable(project);
  if (!gate.ok) {
    return { started: false, queued: false, reason: gate.reason };
  }

  const settings = await getSettings(project.account_id);
  const accountRunning = (
    await listRuns({
      status: "running",
      account_id: project.account_id,
      limit: 1000,
    })
  ).length;
  const projectBusy =
    (await listRuns({ status: "running", project_id: project.id, limit: 1 }))
      .length > 0;
  // The account cap always applies. The per-project "one run at a time" guard is
  // bypassed for worktree runs — they execute in an isolated checkout, so they
  // can run in parallel with the run already in flight on this repo.
  const wantWorktree = !!opts?.worktree;
  if (
    accountRunning >= settings.max_concurrent_runs ||
    (projectBusy && !wantWorktree)
  ) {
    await queueTask(taskId, null);
    return { started: false, queued: true };
  }
  if (await claimTaskForRun(taskId)) {
    // ClickUp tasks with subtasks expand into a shared-branch chain (no single run).
    const res = await startTaskOrChain(task, project, {
      worktree: wantWorktree,
    });
    return { started: true, queued: false, run: res.run ?? undefined };
  }
  return { started: false, queued: false, reason: "No se pudo reclamar la tarea" };
}

async function loop(): Promise<void> {
  try {
    await tick();
  } catch (e) {
    state.lastError = (e as Error).message;
  } finally {
    // One process timer drives the loop, so poll_interval stays a single global
    // cadence anchored to the default account (id 1).
    const settings = await getSettings(1).catch(() => ({
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
