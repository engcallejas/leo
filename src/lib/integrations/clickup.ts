import type {
  ClickUpConfig,
  ClickUpSourceFilter,
  PulledItem,
} from "../types";
import {
  fetchJson,
  truncate,
  type IntegrationProvider,
  type ProviderTestResult,
} from "./provider";

const API = "https://api.clickup.com/api/v2";

function headers(config: ClickUpConfig): HeadersInit {
  return {
    Authorization: config.token,
    "Content-Type": "application/json",
  };
}

interface ClickUpTask {
  id: string;
  name?: string;
  description?: string;
  text_content?: string;
  url?: string;
  status?: { status?: string; type?: string };
  date_updated?: string;
  date_created?: string;
  priority?: { priority?: string } | null;
  assignees?: { username?: string }[];
  tags?: { name?: string }[];
}

export const clickupProvider: IntegrationProvider = {
  type: "clickup",

  async testConnection(raw): Promise<ProviderTestResult> {
    const config = raw as unknown as ClickUpConfig;
    if (!config.token)
      return { ok: false, message: "Falta el token de ClickUp." };
    const { status, body } = await fetchJson(`${API}/user`, {
      headers: headers(config),
    });
    if (status === 200) {
      const user = (body as { user?: { username?: string } })?.user;
      return {
        ok: true,
        message: `Conectado como "${user?.username ?? "usuario"}".`,
      };
    }
    if (status === 401)
      return { ok: false, message: "Token inválido (401)." };
    return { ok: false, message: `ClickUp respondió ${status}.` };
  },

  async poll(raw, rawFilter): Promise<PulledItem[]> {
    const config = raw as unknown as ClickUpConfig;
    const filter = rawFilter as unknown as ClickUpSourceFilter;
    if (!filter.listId) return [];
    const url = `${API}/list/${filter.listId}/task?archived=false&include_closed=false&subtasks=false`;
    const { status, body } = await fetchJson(url, { headers: headers(config) });
    if (status !== 200) {
      throw new Error(
        `ClickUp tasks ${status}: ${truncate(JSON.stringify(body), 300)}`,
      );
    }
    const tasks = ((body as { tasks?: ClickUpTask[] })?.tasks ?? []) as ClickUpTask[];
    const wantStatuses = (filter.statuses ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    return tasks
      .filter((t) => {
        if (wantStatuses.length === 0) return true;
        const st = (t.status?.status ?? "").toLowerCase();
        return wantStatuses.includes(st);
      })
      .map((t) => {
        const desc = t.description || t.text_content || "";
        const lines = [
          `ClickUp task ${t.id}`,
          t.status?.status ? `Status: ${t.status.status}` : "",
          t.priority?.priority ? `Priority: ${t.priority.priority}` : "",
          t.tags?.length ? `Tags: ${t.tags.map((x) => x.name).join(", ")}` : "",
          t.assignees?.length
            ? `Assignees: ${t.assignees.map((a) => a.username).join(", ")}`
            : "",
          "",
          desc,
        ].filter((l) => l !== undefined);
        return {
          external_id: t.id,
          title: truncate(t.name || `Task ${t.id}`, 200),
          description: truncate(lines.join("\n")),
          url: t.url ?? null,
          raw: t,
        } satisfies PulledItem;
      });
  },
};
