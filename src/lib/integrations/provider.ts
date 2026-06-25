import type { IntegrationType, ProjectSource, PulledItem } from "../types";

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export interface IntegrationProvider {
  type: IntegrationType;
  /** Validate the connection config (token, org, etc.). */
  testConnection(config: Record<string, unknown>): Promise<ProviderTestResult>;
  /** Pull current items for a single project source binding. */
  poll(
    config: Record<string, unknown>,
    filter: ProjectSource["filter"],
  ): Promise<PulledItem[]>;
  /**
   * Mark the external item (e.g. a Sentry issue) resolved/closed after a
   * successful run. Optional — providers that don't support it omit it.
   */
  resolveTask?(
    config: Record<string, unknown>,
    externalId: string,
    opts?: { status?: string },
  ): Promise<ProviderTestResult>;
  /** Options to build a source filter (lists / projects) — for UI dropdowns. */
  fetchSourceMeta?(config: Record<string, unknown>): Promise<SourceMeta>;
  /** ClickUp: statuses available in a given list. */
  fetchListStatuses?(
    config: Record<string, unknown>,
    listId: string,
  ): Promise<string[]>;
  /**
   * Fresh, rich context for the prompt at run time: full description, comments,
   * attachments (incl. image URLs), etc. Optional.
   */
  fetchTaskContext?(
    config: Record<string, unknown>,
    externalId: string,
  ): Promise<string>;
  /** Create a task (optionally a subtask via parentId) in a list. */
  createTask?(
    config: Record<string, unknown>,
    listId: string,
    input: { name: string; description?: string; parentId?: string },
  ): Promise<{ id: string; url: string | null }>;
  /** Post a comment on a task. */
  addComment?(
    config: Record<string, unknown>,
    externalId: string,
    text: string,
  ): Promise<ProviderTestResult>;
  /** Resolve the list a task lives in (used to anchor created subtasks). */
  getTaskMeta?(
    config: Record<string, unknown>,
    externalId: string,
  ): Promise<{ listId: string | null; url: string | null }>;
  /** Current (markdown) description of a task. */
  getTaskDescription?(
    config: Record<string, unknown>,
    externalId: string,
  ): Promise<string>;
  /**
   * Fresh seed fields (title/objective/url) pulled live from the source task,
   * used to re-sync a plan with the latest version of its ClickUp task. Returns
   * null if the task can't be read.
   */
  fetchTaskSeed?(
    config: Record<string, unknown>,
    externalId: string,
  ): Promise<{ title: string; objective: string; url: string | null } | null>;
  /** Overwrite a task's description with markdown. */
  updateTaskDescription?(
    config: Record<string, unknown>,
    externalId: string,
    markdown: string,
  ): Promise<ProviderTestResult>;
  /** Subtasks of a task, in order (for subtask-chain execution). */
  fetchSubtasks?(
    config: Record<string, unknown>,
    externalId: string,
  ): Promise<{ id: string; name: string; url: string | null }[]>;
  /** Attachments on a task (used to import images into a plan). */
  fetchAttachments?(
    config: Record<string, unknown>,
    externalId: string,
  ): Promise<
    { title: string; extension: string; url: string; mimetype: string }[]
  >;
  /** Upload a file as an attachment on a task. */
  uploadAttachment?(
    config: Record<string, unknown>,
    externalId: string,
    filename: string,
    data: Buffer,
  ): Promise<ProviderTestResult>;
}

export type SourceMeta =
  | {
      type: "clickup";
      lists: { id: string; name: string; path: string }[];
    }
  | {
      type: "sentry";
      projects: { slug: string; name: string }[];
    };

export async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

export function truncate(s: string, n = 4000): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s;
}
