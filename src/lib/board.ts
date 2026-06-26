// Assembles the unified Kanban board: one card per unit of work, where the
// card is a raw Task while it's still a source-inbox item and becomes its Plan
// once promoted (the Plan is the spine of stages 2–6). Columns are DERIVED from
// status + closed_at, never stored.

import { query } from "./db";
import { listPlans } from "./plan-repo";
import { listProjects, listRuns, listTasks } from "./repo";
import type { BoardCard, BoardColumn, Plan, RunStatus, Task } from "./types";

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
      return "fuentes";
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
 * Build the full board (all cards, unfiltered — the UI filters client-side by
 * project / source / date). Cards are sorted by recency within the response.
 */
export async function assembleBoard(): Promise<BoardCard[]> {
  const [projects, plans, tasks, runs] = await Promise.all([
    listProjects(),
    listPlans({ limit: 500 }),
    listTasks({ limit: 1000 }),
    listRuns({ limit: 500 }),
  ]);
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

  // Latest run per task (runs come ordered id DESC, so first seen wins).
  const latestRunByTask = new Map<number, { id: number; status: RunStatus }>();
  for (const r of runs) {
    if (!latestRunByTask.has(r.task_id)) {
      latestRunByTask.set(r.task_id, { id: r.id, status: r.status });
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
    let runRef: { id: number; status: RunStatus } | undefined;
    const running = steps.find(
      (s) => s.status === "running" && s.task_id != null,
    );
    if (running?.task_id != null) runRef = latestRunByTask.get(running.task_id);
    if (!runRef) {
      for (let i = steps.length - 1; i >= 0; i--) {
        const tid = steps[i].task_id;
        if (tid != null && latestRunByTask.has(tid)) {
          runRef = latestRunByTask.get(tid);
          break;
        }
      }
    }
    cards.push({
      key: `plan-${p.id}`,
      kind: "plan",
      id: p.id,
      column: planColumn(p),
      title: p.title,
      project_id: p.project_id,
      project_name: projName.get(p.project_id) ?? `#${p.project_id}`,
      source_type: p.source_type,
      source_url: p.source_url,
      status: p.status,
      sub: subForPlan(p, total, done),
      date: p.created_at,
      updated_at: p.updated_at,
      steps_total: total,
      steps_done: done,
      run_id: runRef?.id ?? null,
      run_status: runRef?.status ?? null,
      failed: p.status === "failed",
      closed: !!p.closed_at || p.status === "cancelled",
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
      sub: t.source_type === "manual" ? "Manual" : null,
      date: t.created_at,
      updated_at: t.updated_at,
      run_id: runRef?.id ?? null,
      run_status: runRef?.status ?? null,
      failed: t.status === "failed",
      closed: !!t.closed_at || t.status === "cancelled",
    });
  }

  // Most-recently-touched first (the page buckets by column afterward).
  cards.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return cards;
}
