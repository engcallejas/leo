// Assembles the unified Kanban board: one card per unit of work, where the
// card is a raw Task while it's still a source-inbox item and becomes its Plan
// once promoted (the Plan is the spine of stages 2–6). Columns are DERIVED from
// status + closed_at, never stored.

import { query } from "./db";
import { listPlans } from "./plan-repo";
import { getProject, listProjects, listRuns, listTasks } from "./repo";
import type {
  BoardCard,
  BoardColumn,
  Plan,
  Project,
  Run,
  RunStatus,
  Task,
} from "./types";

interface StepLite {
  plan_id: number;
  status: string;
  task_id: number | null;
  position: number;
}

/** Which lane a plan lives in, from its status / closed flag. */
export function planColumn(p: Plan): BoardColumn {
  if (p.closed_at) return "cerrada";
  switch (p.status) {
    case "cancelled":
      return "cerrada";
    case "draft":
    case "refining":
    case "refined":
      return "planeacion";
    case "queued":
      return "cola";
    case "running":
      return "ejecucion";
    case "dispatched":
      // Handed to the ClickUp dev flow: it now lives in a listened "ready for
      // develop" state (the dev source re-pulls it as a runnable task), so it
      // belongs in the dev backlog, not in review.
      return "backlog";
    case "done":
    case "failed":
      return "revision";
    default:
      return "planeacion";
  }
}

/** Which lane a no-plan task lives in. (skipped tasks are filtered out upstream.) */
export function taskColumn(t: Task): BoardColumn {
  if (t.closed_at) return "cerrada";
  switch (t.status) {
    case "cancelled":
      return "cerrada";
    case "pending":
      // Planning-only items are the business inbox (Fuentes, to be refined).
      // Everything else that's runnable (development/both/manual) sits in the
      // dev backlog — the "to-do / ready for develop" lane the scheduler listens
      // to — matching the Dashboard's "Cola de tareas".
      return t.source_role === "planning" ? "fuentes" : "backlog";
    case "queued":
      return "cola";
    case "running":
      return "ejecucion";
    case "done":
    case "failed":
      return "revision";
    default:
      return "fuentes";
  }
}

function subForPlan(p: Plan, total: number, done: number): string | null {
  if (
    total > 0 &&
    (p.status === "running" ||
      p.status === "queued" ||
      p.status === "done" ||
      p.status === "dispatched")
  ) {
    return `${done}/${total} pasos`;
  }
  if (p.status === "draft") return "Sin refinar";
  if (p.status === "refining") return "Refinando…";
  if (p.status === "refined" && total > 0) return `${total} pasos · listo`;
  return null;
}

/**
 * Build the board scoped to a single project (the active view scope), or to a
 * whole account, or unscoped. Cards are sorted by recency within the response.
 */
export async function assembleBoard(
  opts: { projectId?: number | null; accountId?: number } = {},
): Promise<BoardCard[]> {
  const { projectId, accountId } = opts;
  let projects: Project[];
  let plans: Plan[];
  let tasks: Task[];
  let runs: Run[];
  if (projectId != null) {
    const proj = await getProject(projectId);
    projects = proj ? [proj] : [];
    [plans, tasks, runs] = await Promise.all([
      listPlans({ project_id: projectId, limit: 500 }),
      listTasks({ project_id: projectId, limit: 1000 }),
      listRuns({ project_id: projectId, limit: 500 }),
    ]);
  } else {
    [projects, plans, tasks, runs] = await Promise.all([
      listProjects(accountId),
      listPlans({ account_id: accountId, limit: 500 }),
      listTasks({ account_id: accountId, limit: 1000 }),
      listRuns({ account_id: accountId, limit: 500 }),
    ]);
  }
  const projName = new Map(projects.map((p) => [p.id, p.name]));

  // All plan steps in a single query (progress + which tasks belong to a plan).
  const stepRows = await query<Record<string, unknown>>(
    "SELECT plan_id, status, task_id, position FROM plan_steps ORDER BY plan_id ASC, position ASC, id ASC",
  );
  const stepsByPlan = new Map<number, StepLite[]>();
  const stepTaskIds = new Set<number>();
  for (const r of stepRows) {
    const s: StepLite = {
      plan_id: Number(r.plan_id),
      status: String(r.status),
      task_id: r.task_id == null ? null : Number(r.task_id),
      position: Number(r.position ?? 0),
    };
    const arr = stepsByPlan.get(s.plan_id);
    if (arr) arr.push(s);
    else stepsByPlan.set(s.plan_id, [s]);
    if (s.task_id != null) stepTaskIds.add(s.task_id);
  }

  // Latest run per task (runs come ordered id DESC, so first seen wins). We keep
  // enough to reflect iterations (parent_run_id) and worktree runs on the board.
  type RunLite = {
    id: number;
    status: RunStatus;
    parent_run_id: number | null;
    worktree_path: string | null;
  };
  const latestRunByTask = new Map<number, RunLite>();
  for (const r of runs) {
    if (!latestRunByTask.has(r.task_id)) {
      latestRunByTask.set(r.task_id, {
        id: r.id,
        status: r.status,
        parent_run_id: r.parent_run_id,
        worktree_path: r.worktree_path,
      });
    }
  }

  // Source items already owned by a plan → don't also show the raw task.
  const claimed = new Set<string>();
  for (const p of plans) {
    if (p.source_external_id) {
      claimed.add(`${p.project_id}::${p.source_type}::${p.source_external_id}`);
    }
  }

  const cards: BoardCard[] = [];

  // Plan cards.
  for (const p of plans) {
    const steps = stepsByPlan.get(p.id) ?? [];
    const total = steps.length;
    const done = steps.filter((s) => s.status === "done").length;

    // A running run on any of this plan's step tasks means the plan is actively
    // executing right now — including an ITERATION kicked off after the plan
    // already finished (which doesn't change plan.status). Surface it so the
    // card moves to Ejecución and shows the iteration instead of sitting silently
    // in Revisión.
    let activeRun: RunLite | undefined;
    for (const s of steps) {
      if (s.task_id == null) continue;
      const lr = latestRunByTask.get(s.task_id);
      if (lr?.status === "running") {
        activeRun = lr;
        break;
      }
    }
    let runRef = activeRun;
    if (!runRef) {
      for (let i = steps.length - 1; i >= 0; i--) {
        const tid = steps[i].task_id;
        if (tid != null && latestRunByTask.has(tid)) {
          runRef = latestRunByTask.get(tid);
          break;
        }
      }
    }

    const closed = !!p.closed_at || p.status === "cancelled";
    const column: BoardColumn =
      activeRun && !closed ? "ejecucion" : planColumn(p);
    const isIteration = (runRef?.parent_run_id ?? null) != null;
    cards.push({
      key: `plan-${p.id}`,
      kind: "plan",
      id: p.id,
      column,
      title: p.title,
      project_id: p.project_id,
      project_name: projName.get(p.project_id) ?? `#${p.project_id}`,
      source_type: p.source_type,
      source_url: p.source_url,
      status: p.status,
      sub: activeRun && isIteration ? "↻ iterando…" : subForPlan(p, total, done),
      date: p.created_at,
      updated_at: p.updated_at,
      steps_total: total,
      steps_done: done,
      run_id: runRef?.id ?? null,
      run_status: runRef?.status ?? null,
      is_iteration: isIteration,
      is_worktree: !!runRef?.worktree_path,
      failed: p.status === "failed",
      closed,
    });
  }

  // Task cards (raw inbox + no-plan dev/manual flow).
  for (const t of tasks) {
    if (t.parent_task_id != null) continue; // chain subtask, managed by parent
    if (stepTaskIds.has(t.id)) continue; // a plan step's execution task
    if (t.status === "skipped") continue; // discarded from the inbox
    if (claimed.has(`${t.project_id}::${t.source_type}::${t.external_id}`)) {
      continue; // already represented by its plan
    }
    const runRef = latestRunByTask.get(t.id);
    const isIteration = (runRef?.parent_run_id ?? null) != null;
    const iterating = isIteration && runRef?.status === "running";
    cards.push({
      key: `task-${t.id}`,
      kind: "task",
      id: t.id,
      column: taskColumn(t),
      title: t.title,
      project_id: t.project_id,
      project_name: projName.get(t.project_id) ?? `#${t.project_id}`,
      source_type: t.source_type,
      source_url: t.url,
      status: t.status,
      sub: iterating ? "↻ iterando…" : t.source_type === "manual" ? "Manual" : null,
      date: t.created_at,
      updated_at: t.updated_at,
      run_id: runRef?.id ?? null,
      run_status: runRef?.status ?? null,
      is_iteration: isIteration,
      is_worktree: !!runRef?.worktree_path,
      failed: t.status === "failed",
      closed: !!t.closed_at || t.status === "cancelled",
    });
  }

  // Most-recently-touched first (the page buckets by column afterward).
  cards.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return cards;
}
