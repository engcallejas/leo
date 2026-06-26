import { query, queryOne, run } from "./db";
import type {
  AttachedImage,
  Integration,
  IntegrationType,
  McpServer,
  PermissionMode,
  Project,
  ProjectAuthMethod,
  ProjectSource,
  Run,
  RunInteraction,
  RunNote,
  RunStatus,
  SourceRole,
  SourceType,
  Task,
  TaskStatus,
} from "./types";

// ---------- helpers ----------
function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}
function parseJSON<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
function nOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

// ---------- integrations ----------
type IntegrationRow = Record<string, unknown>;

function mapIntegration(r: IntegrationRow): Integration {
  return {
    id: Number(r.id),
    type: r.type as IntegrationType,
    name: String(r.name),
    config: parseJSON(r.config, {} as Integration["config"]),
    enabled: toBool(r.enabled),
    last_polled_at: (r.last_polled_at as string) ?? null,
    last_error: (r.last_error as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listIntegrations(): Promise<Integration[]> {
  const rows = await query<IntegrationRow>(
    "SELECT * FROM integrations ORDER BY id DESC",
  );
  return rows.map(mapIntegration);
}

export async function getIntegration(id: number): Promise<Integration | null> {
  const r = await queryOne<IntegrationRow>(
    "SELECT * FROM integrations WHERE id = ?",
    [id],
  );
  return r ? mapIntegration(r) : null;
}

export interface IntegrationInput {
  type: IntegrationType;
  name: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export async function createIntegration(
  input: IntegrationInput,
): Promise<Integration> {
  const res = await run(
    "INSERT INTO integrations (type, name, config, enabled) VALUES (?, ?, ?, ?)",
    [
      input.type,
      input.name,
      JSON.stringify(input.config ?? {}),
      input.enabled === false ? 0 : 1,
    ],
  );
  return (await getIntegration(res.lastInsertRowid))!;
}

export async function updateIntegration(
  id: number,
  input: Partial<IntegrationInput>,
): Promise<Integration | null> {
  const cur = await getIntegration(id);
  if (!cur) return null;
  await run(
    "UPDATE integrations SET name = ?, config = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?",
    [
      input.name ?? cur.name,
      JSON.stringify(input.config ?? cur.config),
      (input.enabled ?? cur.enabled) ? 1 : 0,
      id,
    ],
  );
  return getIntegration(id);
}

export async function setIntegrationPollResult(
  id: number,
  error: string | null,
): Promise<void> {
  await run(
    "UPDATE integrations SET last_polled_at = datetime('now'), last_error = ? WHERE id = ?",
    [error, id],
  );
}

export async function deleteIntegration(id: number): Promise<void> {
  await run("DELETE FROM integrations WHERE id = ?", [id]);
}

// ---------- projects ----------
type ProjectRow = Record<string, unknown>;

function mapProject(r: ProjectRow): Project {
  return {
    id: Number(r.id),
    name: String(r.name),
    repo_path: String(r.repo_path),
    base_branch: String(r.base_branch),
    target_branch: String(r.target_branch ?? ""),
    prompt_rules: String(r.prompt_rules ?? ""),
    auto_mode: toBool(r.auto_mode),
    permission_mode: (r.permission_mode as PermissionMode) ?? "acceptEdits",
    allowed_tools: (r.allowed_tools as string) ?? null,
    disallowed_tools: (r.disallowed_tools as string) ?? null,
    model: (r.model as string) ?? null,
    max_turns: nOrNull(r.max_turns),
    sources: parseJSON<ProjectSource[]>(r.sources, []),
    enabled: toBool(r.enabled),
    resolve_source_on_done: toBool(r.resolve_source_on_done),
    auth_method: (r.auth_method as ProjectAuthMethod) ?? "inherit",
    mcp_servers: parseJSON<McpServer[]>(r.mcp_servers, []),
    strict_mcp: toBool(r.strict_mcp),
    hooks: String(r.hooks ?? ""),
    spec_globs: String(r.spec_globs ?? ""),
    interactive: toBool(r.interactive),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listProjects(): Promise<Project[]> {
  const rows = await query<ProjectRow>(
    "SELECT * FROM projects ORDER BY id DESC",
  );
  return rows.map(mapProject);
}

export async function getProject(id: number): Promise<Project | null> {
  const r = await queryOne<ProjectRow>("SELECT * FROM projects WHERE id = ?", [
    id,
  ]);
  return r ? mapProject(r) : null;
}

export interface ProjectInput {
  name: string;
  repo_path: string;
  base_branch?: string;
  target_branch?: string;
  prompt_rules?: string;
  auto_mode?: boolean;
  permission_mode?: PermissionMode;
  allowed_tools?: string | null;
  disallowed_tools?: string | null;
  model?: string | null;
  max_turns?: number | null;
  sources?: ProjectSource[];
  enabled?: boolean;
  resolve_source_on_done?: boolean;
  auth_method?: ProjectAuthMethod;
  mcp_servers?: McpServer[];
  strict_mcp?: boolean;
  hooks?: string;
  spec_globs?: string;
  interactive?: boolean;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const res = await run(
    `INSERT INTO projects
       (name, repo_path, base_branch, target_branch, prompt_rules, auto_mode,
        permission_mode, allowed_tools, disallowed_tools, model, max_turns, sources, enabled,
        resolve_source_on_done, auth_method, mcp_servers, strict_mcp, hooks, spec_globs, interactive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.repo_path,
      input.base_branch || "main",
      input.target_branch ?? "",
      input.prompt_rules ?? "",
      input.auto_mode ? 1 : 0,
      input.permission_mode ?? "acceptEdits",
      input.allowed_tools ?? null,
      input.disallowed_tools ?? null,
      input.model ?? null,
      input.max_turns ?? null,
      JSON.stringify(input.sources ?? []),
      input.enabled === false ? 0 : 1,
      input.resolve_source_on_done === false ? 0 : 1,
      input.auth_method ?? "inherit",
      JSON.stringify(input.mcp_servers ?? []),
      input.strict_mcp ? 1 : 0,
      input.hooks ?? "",
      input.spec_globs ?? "",
      input.interactive ? 1 : 0,
    ],
  );
  return (await getProject(res.lastInsertRowid))!;
}

export async function updateProject(
  id: number,
  input: Partial<ProjectInput>,
): Promise<Project | null> {
  const cur = await getProject(id);
  if (!cur) return null;
  const merged = { ...cur, ...input };
  await run(
    `UPDATE projects SET
       name = ?, repo_path = ?, base_branch = ?, target_branch = ?, prompt_rules = ?,
       auto_mode = ?, permission_mode = ?, allowed_tools = ?, disallowed_tools = ?,
       model = ?, max_turns = ?, sources = ?, enabled = ?, resolve_source_on_done = ?,
       auth_method = ?, mcp_servers = ?, strict_mcp = ?, hooks = ?, spec_globs = ?,
       interactive = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      merged.name,
      merged.repo_path,
      merged.base_branch || "main",
      merged.target_branch ?? "",
      merged.prompt_rules ?? "",
      merged.auto_mode ? 1 : 0,
      merged.permission_mode ?? "acceptEdits",
      merged.allowed_tools ?? null,
      merged.disallowed_tools ?? null,
      merged.model ?? null,
      merged.max_turns ?? null,
      JSON.stringify(merged.sources ?? []),
      merged.enabled ? 1 : 0,
      merged.resolve_source_on_done ? 1 : 0,
      merged.auth_method ?? "inherit",
      JSON.stringify(merged.mcp_servers ?? []),
      merged.strict_mcp ? 1 : 0,
      merged.hooks ?? "",
      merged.spec_globs ?? "",
      merged.interactive ? 1 : 0,
      id,
    ],
  );
  return getProject(id);
}

export async function deleteProject(id: number): Promise<void> {
  await run("DELETE FROM projects WHERE id = ?", [id]);
}

// ---------- tasks ----------
type TaskRow = Record<string, unknown>;

function mapTask(r: TaskRow): Task {
  return {
    id: Number(r.id),
    project_id: Number(r.project_id),
    integration_id: nOrNull(r.integration_id),
    source_type: r.source_type as SourceType,
    external_id: String(r.external_id),
    title: String(r.title),
    description: String(r.description ?? ""),
    url: (r.url as string) ?? null,
    raw: parseJSON(r.raw, null),
    status: r.status as TaskStatus,
    scheduled_for: (r.scheduled_for as string) ?? null,
    source_role: (r.source_role as SourceRole) ?? "development",
    parent_task_id: nOrNull(r.parent_task_id),
    chain_branch: (r.chain_branch as string) ?? null,
    closed_at: (r.closed_at as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export interface TaskInput {
  project_id: number;
  integration_id: number | null;
  source_type: SourceType;
  external_id: string;
  title: string;
  description?: string;
  url?: string | null;
  raw?: unknown;
  status?: TaskStatus;
  scheduled_for?: string | null;
  source_role?: SourceRole;
}

/** Insert or ignore (dedup on project_id+source_type+external_id). Returns the task. */
export async function upsertTask(input: TaskInput): Promise<Task | null> {
  await run(
    `INSERT INTO tasks
       (project_id, integration_id, source_type, external_id, title, description, url, raw, status, scheduled_for, source_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, source_type, external_id) DO UPDATE SET
       source_role = excluded.source_role,
       updated_at = datetime('now')`,
    [
      input.project_id,
      input.integration_id,
      input.source_type,
      input.external_id,
      input.title,
      input.description ?? "",
      input.url ?? null,
      input.raw != null ? JSON.stringify(input.raw) : null,
      input.status ?? "pending",
      input.scheduled_for ?? null,
      input.source_role ?? "development",
    ],
  );
  const r = await queryOne<TaskRow>(
    "SELECT * FROM tasks WHERE project_id = ? AND source_type = ? AND external_id = ?",
    [input.project_id, input.source_type, input.external_id],
  );
  return r ? mapTask(r) : null;
}

export async function listTasks(filter?: {
  status?: TaskStatus;
  project_id?: number;
  limit?: number;
}): Promise<Task[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter?.project_id) {
    where.push("project_id = ?");
    args.push(filter.project_id);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter?.limit ?? 200;
  const rows = await query<TaskRow>(
    `SELECT * FROM tasks ${clause} ORDER BY id DESC LIMIT ?`,
    [...args, limit],
  );
  return rows.map(mapTask);
}

export async function getTask(id: number): Promise<Task | null> {
  const r = await queryOne<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
  return r ? mapTask(r) : null;
}

export async function setTaskStatus(
  id: number,
  status: TaskStatus,
): Promise<void> {
  await run(
    "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
    [status, id],
  );
}

/** Close (archive) or reopen a task card. Uses SQL datetime for a stable format. */
export async function setTaskClosed(
  id: number,
  closed: boolean,
): Promise<void> {
  await run(
    `UPDATE tasks SET closed_at = ${closed ? "datetime('now')" : "NULL"}, updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
}

/**
 * Edit a task's local business fields. Polling never overwrites title/description
 * (upsertTask's ON CONFLICT only touches source_role), so these edits persist.
 */
export async function updateTaskFields(
  id: number,
  patch: { title?: string; description?: string; url?: string | null },
): Promise<Task | null> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    args.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    args.push(patch.description);
  }
  if (patch.url !== undefined) {
    sets.push("url = ?");
    args.push(patch.url);
  }
  if (sets.length === 0) return getTask(id);
  sets.push("updated_at = datetime('now')");
  await run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  return getTask(id);
}

/** Queue a task (optionally scheduled for a future ISO datetime). */
export async function queueTask(
  id: number,
  scheduledFor: string | null,
): Promise<void> {
  await run(
    "UPDATE tasks SET status = 'queued', scheduled_for = ?, updated_at = datetime('now') WHERE id = ?",
    [scheduledFor, id],
  );
}

/**
 * Reconcile a source inbox: delete the still-pending, non-closed, non-chain tasks
 * of a (project, integration, source) whose external_id is no longer returned by
 * the source poll — i.e. they were deleted/moved away on the other side. Only the
 * untouched inbox is pruned; queued/running/done/promoted tasks are left alone.
 * Returns how many were removed.
 */
export async function prunePendingSourceTasks(
  projectId: number,
  integrationId: number,
  sourceType: SourceType,
  keepExternalIds: string[],
): Promise<number> {
  const rows = await query<{ id: number; external_id: string }>(
    `SELECT id, external_id FROM tasks
       WHERE project_id = ? AND integration_id = ? AND source_type = ?
         AND status = 'pending' AND closed_at IS NULL AND parent_task_id IS NULL`,
    [projectId, integrationId, sourceType],
  );
  const keep = new Set(keepExternalIds.map(String));
  const stale = rows.filter((r) => !keep.has(String(r.external_id)));
  for (const r of stale) {
    await run("DELETE FROM tasks WHERE id = ?", [r.id]);
  }
  return stale.length;
}

/** Atomically claim a pending/queued task by flipping it to 'running'. */
export async function claimTaskForRun(id: number): Promise<boolean> {
  const res = await run(
    "UPDATE tasks SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status IN ('pending','queued','failed','done')",
    [id],
  );
  return res.rowsAffected > 0;
}

// ---------- subtask chains ----------
/** Mark a task as a chain parent (its subtasks run on a shared branch). */
export async function markChainParent(
  id: number,
  branch: string,
): Promise<void> {
  await run(
    "UPDATE tasks SET chain_branch = ?, updated_at = datetime('now') WHERE id = ?",
    [branch, id],
  );
}

/** Top-level chain parents currently orchestrating their subtasks. */
export async function listChainParents(): Promise<Task[]> {
  const rows = await query<TaskRow>(
    "SELECT * FROM tasks WHERE chain_branch IS NOT NULL AND parent_task_id IS NULL AND status = 'running'",
  );
  return rows.map(mapTask);
}

/** A chain parent's child (subtask) tasks, ordered by id (creation order). */
export async function listChildTasks(parentId: number): Promise<Task[]> {
  const rows = await query<TaskRow>(
    "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY id ASC",
    [parentId],
  );
  return rows.map(mapTask);
}

/** Create (or refresh) the child task that executes one subtask of a chain. */
export async function createChainChild(input: {
  project_id: number;
  integration_id: number | null;
  external_id: string;
  title: string;
  url: string | null;
  raw: unknown;
  parent_task_id: number;
  chain_branch: string;
}): Promise<Task> {
  await run(
    `INSERT INTO tasks
       (project_id, integration_id, source_type, external_id, title, url, raw, status, source_role, parent_task_id, chain_branch)
     VALUES (?, ?, 'clickup', ?, ?, ?, ?, 'running', 'development', ?, ?)
     ON CONFLICT(project_id, source_type, external_id) DO UPDATE SET
       status = 'running', parent_task_id = excluded.parent_task_id,
       chain_branch = excluded.chain_branch, updated_at = datetime('now')`,
    [
      input.project_id,
      input.integration_id,
      input.external_id,
      input.title,
      input.url,
      input.raw != null ? JSON.stringify(input.raw) : null,
      input.parent_task_id,
      input.chain_branch,
    ],
  );
  const r = await queryOne<TaskRow>(
    "SELECT * FROM tasks WHERE project_id = ? AND source_type = 'clickup' AND external_id = ?",
    [input.project_id, input.external_id],
  );
  return mapTask(r!);
}

// ---------- runs ----------
type RunRow = Record<string, unknown>;

function mapRun(r: RunRow): Run {
  return {
    id: Number(r.id),
    task_id: Number(r.task_id),
    project_id: Number(r.project_id),
    parent_run_id: nOrNull(r.parent_run_id),
    status: r.status as RunStatus,
    pid: nOrNull(r.pid),
    session_id: (r.session_id as string) ?? null,
    num_turns: nOrNull(r.num_turns),
    cost_usd: r.cost_usd == null ? null : Number(r.cost_usd),
    duration_ms: nOrNull(r.duration_ms),
    exit_code: nOrNull(r.exit_code),
    result_summary: (r.result_summary as string) ?? null,
    error: (r.error as string) ?? null,
    log_path: String(r.log_path),
    started_at: String(r.started_at),
    finished_at: (r.finished_at as string) ?? null,
  };
}

export async function createRun(input: {
  task_id: number;
  project_id: number;
  log_path: string;
  parent_run_id?: number | null;
}): Promise<Run> {
  const res = await run(
    "INSERT INTO runs (task_id, project_id, parent_run_id, status, log_path) VALUES (?, ?, ?, 'running', ?)",
    [input.task_id, input.project_id, input.parent_run_id ?? null, input.log_path],
  );
  return (await getRun(res.lastInsertRowid))!;
}

export async function getRun(id: number): Promise<Run | null> {
  const r = await queryOne<RunRow>("SELECT * FROM runs WHERE id = ?", [id]);
  return r ? mapRun(r) : null;
}

export async function updateRun(
  id: number,
  patch: Partial<{
    status: RunStatus;
    pid: number | null;
    session_id: string | null;
    num_turns: number | null;
    cost_usd: number | null;
    duration_ms: number | null;
    exit_code: number | null;
    result_summary: string | null;
    error: string | null;
    finished: boolean;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const push = (col: string, val: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.pid !== undefined) push("pid", patch.pid);
  if (patch.session_id !== undefined) push("session_id", patch.session_id);
  if (patch.num_turns !== undefined) push("num_turns", patch.num_turns);
  if (patch.cost_usd !== undefined) push("cost_usd", patch.cost_usd);
  if (patch.duration_ms !== undefined) push("duration_ms", patch.duration_ms);
  if (patch.exit_code !== undefined) push("exit_code", patch.exit_code);
  if (patch.result_summary !== undefined)
    push("result_summary", patch.result_summary);
  if (patch.error !== undefined) push("error", patch.error);
  if (patch.finished) sets.push("finished_at = datetime('now')");
  if (sets.length === 0) return;
  await run(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
}

export async function listRuns(filter?: {
  task_id?: number;
  project_id?: number;
  status?: RunStatus;
  limit?: number;
}): Promise<Run[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter?.task_id) {
    where.push("task_id = ?");
    args.push(filter.task_id);
  }
  if (filter?.project_id) {
    where.push("project_id = ?");
    args.push(filter.project_id);
  }
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter?.limit ?? 100;
  const rows = await query<RunRow>(
    `SELECT * FROM runs ${clause} ORDER BY id DESC LIMIT ?`,
    [...args, limit],
  );
  return rows.map(mapRun);
}

/** Recover orphaned runs left 'running' after a crash/restart. */
export async function reconcileOrphanRuns(): Promise<void> {
  await run(
    "UPDATE runs SET status = 'failed', error = 'Interrupted by server restart', finished_at = datetime('now') WHERE status = 'running'",
  );
  await run(
    "UPDATE tasks SET status = 'failed', updated_at = datetime('now') WHERE status = 'running'",
  );
}

// ---------- run interactions (ask_user) ----------
type InteractionRow = Record<string, unknown>;

function mapInteraction(r: InteractionRow): RunInteraction {
  return {
    id: Number(r.id),
    run_id: nOrNull(r.run_id),
    plan_id: nOrNull(r.plan_id),
    task_id: nOrNull(r.task_id),
    kind: (r.kind as RunInteraction["kind"]) ?? "question",
    question: String(r.question),
    options: parseJSON<string[]>(r.options, []),
    status: (r.status as RunInteraction["status"]) ?? "pending",
    answer: (r.answer as string) ?? null,
    created_at: String(r.created_at),
    answered_at: (r.answered_at as string) ?? null,
  };
}

export async function createInteraction(input: {
  run_id?: number | null;
  plan_id?: number | null;
  task_id: number | null;
  kind: RunInteraction["kind"];
  question: string;
  options: string[];
}): Promise<RunInteraction> {
  const res = await run(
    "INSERT INTO run_interactions (run_id, plan_id, task_id, kind, question, options) VALUES (?, ?, ?, ?, ?, ?)",
    [
      input.run_id ?? null,
      input.plan_id ?? null,
      input.task_id,
      input.kind,
      input.question,
      JSON.stringify(input.options ?? []),
    ],
  );
  return (await getInteraction(res.lastInsertRowid))!;
}

export async function getInteraction(
  id: number,
): Promise<RunInteraction | null> {
  const r = await queryOne<InteractionRow>(
    "SELECT * FROM run_interactions WHERE id = ?",
    [id],
  );
  return r ? mapInteraction(r) : null;
}

export async function listInteractions(filter?: {
  run_id?: number;
  plan_id?: number;
  status?: RunInteraction["status"];
  limit?: number;
}): Promise<RunInteraction[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter?.run_id) {
    where.push("run_id = ?");
    args.push(filter.run_id);
  }
  if (filter?.plan_id) {
    where.push("plan_id = ?");
    args.push(filter.plan_id);
  }
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query<InteractionRow>(
    `SELECT * FROM run_interactions ${clause} ORDER BY id ASC LIMIT ?`,
    [...args, filter?.limit ?? 100],
  );
  return rows.map(mapInteraction);
}

export async function answerInteraction(
  id: number,
  answer: string,
): Promise<RunInteraction | null> {
  await run(
    "UPDATE run_interactions SET status = 'answered', answer = ?, answered_at = datetime('now') WHERE id = ? AND status = 'pending'",
    [answer, id],
  );
  return getInteraction(id);
}

/** Cancel any still-pending interactions for a run (e.g. when it finishes). */
export async function cancelRunInteractions(runId: number): Promise<void> {
  await run(
    "UPDATE run_interactions SET status = 'cancelled', answered_at = datetime('now') WHERE run_id = ? AND status = 'pending'",
    [runId],
  );
}

/** Cancel any still-pending interactions for a plan (e.g. refinement ended). */
export async function cancelPlanInteractions(planId: number): Promise<void> {
  await run(
    "UPDATE run_interactions SET status = 'cancelled', answered_at = datetime('now') WHERE plan_id = ? AND status = 'pending'",
    [planId],
  );
}

// ---------- run notes (human → agent steering) ----------
function mapNote(r: Record<string, unknown>): RunNote {
  let images: AttachedImage[] = [];
  if (r.images) {
    try {
      const parsed = JSON.parse(String(r.images));
      if (Array.isArray(parsed)) images = parsed as AttachedImage[];
    } catch {
      /* malformed → none */
    }
  }
  return {
    id: Number(r.id),
    run_id: Number(r.run_id),
    text: String(r.text),
    images,
    delivered: Number(r.delivered) === 1,
    created_at: String(r.created_at),
    delivered_at: (r.delivered_at as string) ?? null,
  };
}

export async function addRunNote(
  runId: number,
  text: string,
  images: AttachedImage[] = [],
): Promise<RunNote> {
  const res = await run(
    "INSERT INTO run_notes (run_id, text, images) VALUES (?, ?, ?)",
    [runId, text, images.length ? JSON.stringify(images) : null],
  );
  const r = await queryOne<Record<string, unknown>>(
    "SELECT * FROM run_notes WHERE id = ?",
    [Number(res.lastInsertRowid)],
  );
  return mapNote(r!);
}

export async function listRunNotes(runId: number): Promise<RunNote[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM run_notes WHERE run_id = ? ORDER BY id ASC",
    [runId],
  );
  return rows.map(mapNote);
}

/** Return undelivered notes for a run and mark them delivered (atomic-ish). */
export async function consumePendingRunNotes(runId: number): Promise<RunNote[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM run_notes WHERE run_id = ? AND delivered = 0 ORDER BY id ASC",
    [runId],
  );
  const notes = rows.map(mapNote);
  if (notes.length) {
    await run(
      "UPDATE run_notes SET delivered = 1, delivered_at = datetime('now') WHERE run_id = ? AND delivered = 0",
      [runId],
    );
  }
  return notes;
}

export async function countByStatus(): Promise<{
  projects: number;
  integrations: number;
  pendingTasks: number;
  runningRuns: number;
}> {
  const p = await queryOne<{ c: number }>("SELECT COUNT(*) c FROM projects");
  const i = await queryOne<{ c: number }>("SELECT COUNT(*) c FROM integrations");
  const t = await queryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM tasks WHERE status IN ('pending','queued')",
  );
  const r = await queryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM runs WHERE status = 'running'",
  );
  return {
    projects: Number(p?.c ?? 0),
    integrations: Number(i?.c ?? 0),
    pendingTasks: Number(t?.c ?? 0),
    runningRuns: Number(r?.c ?? 0),
  };
}
