import { query, queryOne, run } from "./db";
import type {
  Plan,
  PlanStatus,
  PlanStep,
  PlanStepStatus,
  PlanWithSteps,
  SourceType,
} from "./types";

// ---------- helpers ----------
function nOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

// ---------- plans ----------
type PlanRow = Record<string, unknown>;

function mapPlan(r: PlanRow): Plan {
  return {
    id: Number(r.id),
    project_id: Number(r.project_id),
    title: String(r.title),
    objective: String(r.objective ?? ""),
    source_type: (r.source_type as SourceType) ?? "manual",
    source_integration_id: nOrNull(r.source_integration_id),
    source_external_id: (r.source_external_id as string) ?? null,
    source_url: (r.source_url as string) ?? null,
    refined_spec: String(r.refined_spec ?? ""),
    status: (r.status as PlanStatus) ?? "draft",
    scheduled_for: (r.scheduled_for as string) ?? null,
    clickup_parent_id: (r.clickup_parent_id as string) ?? null,
    refine_pid: nOrNull(r.refine_pid),
    refine_log: (r.refine_log as string) ?? null,
    error: (r.error as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export interface PlanInput {
  project_id: number;
  title: string;
  objective?: string;
  source_type?: SourceType;
  source_integration_id?: number | null;
  source_external_id?: string | null;
  source_url?: string | null;
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  const res = await run(
    `INSERT INTO plans
       (project_id, title, objective, source_type, source_integration_id,
        source_external_id, source_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      input.project_id,
      input.title,
      input.objective ?? "",
      input.source_type ?? "manual",
      input.source_integration_id ?? null,
      input.source_external_id ?? null,
      input.source_url ?? null,
    ],
  );
  return (await getPlan(res.lastInsertRowid))!;
}

export async function getPlan(id: number): Promise<Plan | null> {
  const r = await queryOne<PlanRow>("SELECT * FROM plans WHERE id = ?", [id]);
  return r ? mapPlan(r) : null;
}

export async function getPlanWithSteps(
  id: number,
): Promise<PlanWithSteps | null> {
  const plan = await getPlan(id);
  if (!plan) return null;
  return { ...plan, steps: await listSteps(id) };
}

export async function listPlans(filter?: {
  project_id?: number;
  status?: PlanStatus;
  limit?: number;
}): Promise<Plan[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter?.project_id) {
    where.push("project_id = ?");
    args.push(filter.project_id);
  }
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter?.limit ?? 200;
  const rows = await query<PlanRow>(
    `SELECT * FROM plans ${clause} ORDER BY id DESC LIMIT ?`,
    [...args, limit],
  );
  return rows.map(mapPlan);
}

export async function updatePlan(
  id: number,
  patch: Partial<{
    title: string;
    objective: string;
    refined_spec: string;
    status: PlanStatus;
    scheduled_for: string | null;
    clickup_parent_id: string | null;
    refine_pid: number | null;
    refine_log: string | null;
    error: string | null;
  }>,
): Promise<Plan | null> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const push = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.title !== undefined) push("title", patch.title);
  if (patch.objective !== undefined) push("objective", patch.objective);
  if (patch.refined_spec !== undefined) push("refined_spec", patch.refined_spec);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.scheduled_for !== undefined)
    push("scheduled_for", patch.scheduled_for);
  if (patch.clickup_parent_id !== undefined)
    push("clickup_parent_id", patch.clickup_parent_id);
  if (patch.refine_pid !== undefined) push("refine_pid", patch.refine_pid);
  if (patch.refine_log !== undefined) push("refine_log", patch.refine_log);
  if (patch.error !== undefined) push("error", patch.error);
  if (sets.length === 0) return getPlan(id);
  sets.push("updated_at = datetime('now')");
  await run(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  return getPlan(id);
}

export async function deletePlan(id: number): Promise<void> {
  await run("DELETE FROM plans WHERE id = ?", [id]);
}

// ---------- plan steps ----------
type StepRow = Record<string, unknown>;

function mapStep(r: StepRow): PlanStep {
  return {
    id: Number(r.id),
    plan_id: Number(r.plan_id),
    position: Number(r.position ?? 0),
    title: String(r.title),
    spec: String(r.spec ?? ""),
    status: (r.status as PlanStepStatus) ?? "pending",
    task_id: nOrNull(r.task_id),
    clickup_task_id: (r.clickup_task_id as string) ?? null,
    result_summary: (r.result_summary as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listSteps(planId: number): Promise<PlanStep[]> {
  const rows = await query<StepRow>(
    "SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY position ASC, id ASC",
    [planId],
  );
  return rows.map(mapStep);
}

export async function getStep(id: number): Promise<PlanStep | null> {
  const r = await queryOne<StepRow>("SELECT * FROM plan_steps WHERE id = ?", [
    id,
  ]);
  return r ? mapStep(r) : null;
}

export async function addStep(
  planId: number,
  input: { title: string; spec?: string; position?: number },
): Promise<PlanStep> {
  let position = input.position;
  if (position == null) {
    const max = await queryOne<{ m: number | null }>(
      "SELECT MAX(position) m FROM plan_steps WHERE plan_id = ?",
      [planId],
    );
    position = (max?.m ?? -1) + 1;
  }
  const res = await run(
    "INSERT INTO plan_steps (plan_id, position, title, spec, status) VALUES (?, ?, ?, ?, 'pending')",
    [planId, position, input.title, input.spec ?? ""],
  );
  return (await getStep(res.lastInsertRowid))!;
}

export async function updateStep(
  id: number,
  patch: Partial<{
    title: string;
    spec: string;
    position: number;
    status: PlanStepStatus;
    task_id: number | null;
    clickup_task_id: string | null;
    result_summary: string | null;
  }>,
): Promise<PlanStep | null> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const push = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.title !== undefined) push("title", patch.title);
  if (patch.spec !== undefined) push("spec", patch.spec);
  if (patch.position !== undefined) push("position", patch.position);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.task_id !== undefined) push("task_id", patch.task_id);
  if (patch.clickup_task_id !== undefined)
    push("clickup_task_id", patch.clickup_task_id);
  if (patch.result_summary !== undefined)
    push("result_summary", patch.result_summary);
  if (sets.length === 0) return getStep(id);
  sets.push("updated_at = datetime('now')");
  await run(`UPDATE plan_steps SET ${sets.join(", ")} WHERE id = ?`, [
    ...args,
    id,
  ]);
  return getStep(id);
}

export async function deleteStep(id: number): Promise<void> {
  await run("DELETE FROM plan_steps WHERE id = ?", [id]);
}

/** Replace all steps of a plan (used after refinement / bulk edit). */
export async function replaceSteps(
  planId: number,
  steps: { title: string; spec: string }[],
): Promise<void> {
  await run("DELETE FROM plan_steps WHERE plan_id = ?", [planId]);
  for (let i = 0; i < steps.length; i++) {
    await run(
      "INSERT INTO plan_steps (plan_id, position, title, spec, status) VALUES (?, ?, ?, ?, 'pending')",
      [planId, i, steps[i].title, steps[i].spec ?? ""],
    );
  }
}

/**
 * Create (or refresh) the Leo task that executes a plan step. Uses a stable
 * external id per step so re-runs update in place. Returns the task id.
 */
export async function upsertStepTask(input: {
  project_id: number;
  source_type: SourceType;
  integration_id: number | null;
  external_id: string;
  title: string;
  description: string;
  url: string | null;
  raw: unknown;
}): Promise<number> {
  await run(
    `INSERT INTO tasks
       (project_id, integration_id, source_type, external_id, title, description, url, raw, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')
     ON CONFLICT(project_id, source_type, external_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       url = excluded.url,
       raw = excluded.raw,
       status = 'queued',
       scheduled_for = NULL,
       updated_at = datetime('now')`,
    [
      input.project_id,
      input.integration_id,
      input.source_type,
      input.external_id,
      input.title,
      input.description,
      input.url,
      input.raw != null ? JSON.stringify(input.raw) : null,
    ],
  );
  const r = await queryOne<{ id: number }>(
    "SELECT id FROM tasks WHERE project_id = ? AND source_type = ? AND external_id = ?",
    [input.project_id, input.source_type, input.external_id],
  );
  return Number(r!.id);
}
