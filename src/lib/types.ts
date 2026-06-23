// Shared domain types for Leo, the local Claude Code task orchestrator.

export type IntegrationType = "sentry" | "clickup";

export type SourceType = IntegrationType | "manual";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

/** How Claude Code authenticates the model calls. */
export type AuthMethod = "subscription" | "api-key";
/** Per-project: inherit the global method or override it. */
export type ProjectAuthMethod = "inherit" | AuthMethod;

/** Global execution/model config (non-sensitive view). */
export interface ExecConfig {
  method: AuthMethod;
  apiKeySet: boolean;
  defaultModel: string;
}

export type TaskStatus =
  | "pending" // pulled, waiting (manual project) or about to be queued (auto)
  | "queued" // accepted for execution, waiting for a free run slot
  | "running" // a run is in flight
  | "done" // last run finished successfully
  | "failed" // last run failed
  | "skipped" // intentionally not run
  | "cancelled";

export type RunStatus = "running" | "done" | "failed" | "cancelled";

export interface Integration {
  id: number;
  type: IntegrationType;
  name: string;
  /** Connection config. Tokens live here (plain text — local only). */
  config: SentryConfig | ClickUpConfig;
  enabled: boolean;
  last_polled_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SentryConfig {
  token: string;
  org: string;
  /** https://sentry.io by default; override for self-hosted. */
  baseUrl?: string;
}

export interface ClickUpConfig {
  token: string;
  /** Optional, only used for display. */
  teamId?: string;
}

/**
 * A binding declared on a project: "pull items matching <filter> from
 * <integration> and turn them into tasks for me".
 */
export interface ProjectSource {
  integration_id: number;
  type: IntegrationType;
  /**
   * sentry: { projectSlug, query }  |  clickup: { listId, statuses }.
   * Stored generically; providers cast to their specific filter shape.
   */
  filter: Record<string, unknown>;
}

export interface SentrySourceFilter {
  projectSlug: string;
  /** e.g. "is:unresolved". Defaults to is:unresolved. */
  query?: string;
}

export interface ClickUpSourceFilter {
  listId: string;
  /** Only pull tasks whose status name is in this list. Empty = all. */
  statuses?: string[];
}

export interface Project {
  id: number;
  name: string;
  repo_path: string;
  base_branch: string;
  target_branch: string;
  /** Free-text rules: what it can / must / must-not / should-not do. */
  prompt_rules: string;
  auto_mode: boolean;
  permission_mode: PermissionMode;
  /** Comma-separated tool allow/deny lists passed to the claude CLI. */
  allowed_tools: string | null;
  disallowed_tools: string | null;
  /** Optional model override (e.g. claude-opus-4-8). */
  model: string | null;
  /** Cap turns to avoid runaway runs. 0/empty = no cap. */
  max_turns: number | null;
  sources: ProjectSource[];
  enabled: boolean;
  /** On a successful run, mark the source item (e.g. Sentry issue) resolved. */
  resolve_source_on_done: boolean;
  /** Auth method for this project: inherit global, or force subscription/api-key. */
  auth_method: ProjectAuthMethod;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  project_id: number;
  integration_id: number | null;
  source_type: SourceType;
  external_id: string;
  title: string;
  description: string;
  url: string | null;
  raw: unknown;
  status: TaskStatus;
  /** ISO datetime; if set and in the future, the task waits until then. */
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: number;
  task_id: number;
  project_id: number;
  status: RunStatus;
  pid: number | null;
  session_id: string | null;
  num_turns: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  exit_code: number | null;
  result_summary: string | null;
  error: string | null;
  log_path: string;
  started_at: string;
  finished_at: string | null;
}

/** Normalized item returned by an integration provider when polling. */
export interface PulledItem {
  external_id: string;
  title: string;
  description: string;
  url: string | null;
  raw: unknown;
}

// ---------- planning / refinement ----------

export type PlanStatus =
  | "draft" // created, no refinement yet
  | "refining" // a refinement run is in flight
  | "refined" // has a refined spec + steps, ready to push/enqueue
  | "queued" // orchestration requested, waiting for the first step
  | "running" // a step is executing
  | "done" // all steps finished successfully
  | "failed" // a step failed (orchestration stopped)
  | "cancelled";

export type PlanStepStatus =
  | "pending" // not dispatched yet
  | "queued" // a Leo task was created and is waiting for a run slot
  | "running" // its run is in flight
  | "done"
  | "failed"
  | "skipped";

/** A refinement effort for a project: turns one seed into an ordered plan. */
export interface Plan {
  id: number;
  project_id: number;
  title: string;
  /** The user's goal / seed summary in their own words. */
  objective: string;
  source_type: SourceType;
  source_integration_id: number | null;
  /** Originating ClickUp task id / Sentry issue id, if any. */
  source_external_id: string | null;
  source_url: string | null;
  /** Overall refined requirement (markdown), produced by the refinement run. */
  refined_spec: string;
  status: PlanStatus;
  /** ISO datetime; if set and in the future, orchestration waits until then. */
  scheduled_for: string | null;
  /** ClickUp parent task the steps were pushed under, if any. */
  clickup_parent_id: string | null;
  refine_pid: number | null;
  refine_log: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanStep {
  id: number;
  plan_id: number;
  position: number;
  title: string;
  /** Per-step instructions (the refined requirement for this slice of work). */
  spec: string;
  status: PlanStepStatus;
  /** The Leo task created to execute this step, once dispatched. */
  task_id: number | null;
  /** The ClickUp subtask created for this step, once pushed. */
  clickup_task_id: string | null;
  /** Captured run summary — fed forward as cumulative context to later steps. */
  result_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanWithSteps extends Plan {
  steps: PlanStep[];
}

/** Structured output a refinement run is expected to produce. */
export interface RefineResult {
  title?: string;
  refined_spec: string;
  steps: { title: string; spec: string }[];
}

export interface AppSettings {
  poll_interval_seconds: number;
  max_concurrent_runs: number;
  claude_binary_path: string;
  /** Master switch: when false the scheduler polls but never auto-runs. */
  auto_run_enabled: boolean;
}
