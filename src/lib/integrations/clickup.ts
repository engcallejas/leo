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
  type SourceMeta,
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

  async fetchSourceMeta(raw): Promise<SourceMeta> {
    const config = raw as unknown as ClickUpConfig;
    const h = headers(config);
    const lists: { id: string; name: string; path: string }[] = [];

    const teams =
      ((await fetchJson(`${API}/team`, { headers: h })).body as {
        teams?: { id: string; name: string }[];
      })?.teams ?? [];

    for (const team of teams) {
      const spaces =
        ((
          await fetchJson(`${API}/team/${team.id}/space?archived=false`, {
            headers: h,
          })
        ).body as { spaces?: { id: string; name: string }[] })?.spaces ?? [];
      for (const space of spaces) {
        const base = `${team.name} / ${space.name}`;
        // Folderless lists
        const fll =
          ((
            await fetchJson(`${API}/space/${space.id}/list?archived=false`, {
              headers: h,
            })
          ).body as { lists?: { id: string; name: string }[] })?.lists ?? [];
        for (const l of fll) lists.push({ id: l.id, name: l.name, path: base });
        // Lists inside folders
        const folders =
          ((
            await fetchJson(`${API}/space/${space.id}/folder?archived=false`, {
              headers: h,
            })
          ).body as {
            folders?: { name: string; lists?: { id: string; name: string }[] }[];
          })?.folders ?? [];
        for (const f of folders) {
          for (const l of f.lists ?? [])
            lists.push({ id: l.id, name: l.name, path: `${base} / ${f.name}` });
        }
      }
    }
    return { type: "clickup", lists };
  },

  async fetchListStatuses(raw, listId): Promise<string[]> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(`${API}/list/${listId}`, {
      headers: headers(config),
    });
    if (status !== 200) return [];
    const statuses =
      (body as { statuses?: { status?: string }[] })?.statuses ?? [];
    return statuses.map((s) => s.status ?? "").filter(Boolean);
  },

  async resolveTask(raw, externalId, opts): Promise<ProviderTestResult> {
    const config = raw as unknown as ClickUpConfig;
    const status = opts?.status;
    if (!status) {
      return {
        ok: false,
        message:
          "Sin 'estado al completar' configurado en la fuente ClickUp; no se movió la tarea.",
      };
    }
    const { status: code, body } = await fetchJson(`${API}/task/${externalId}`, {
      method: "PUT",
      headers: headers(config),
      body: JSON.stringify({ status }),
    });
    if (code === 200) {
      return { ok: true, message: `Tarea ClickUp movida a "${status}".` };
    }
    return {
      ok: false,
      message: `ClickUp PUT task ${code}: ${truncate(JSON.stringify(body), 150)}`,
    };
  },

  async fetchTaskContext(raw, externalId): Promise<string> {
    const config = raw as unknown as ClickUpConfig;
    const h = headers(config);
    const parts: string[] = [];

    const taskRes = await fetchJson(`${API}/task/${externalId}`, { headers: h });
    if (taskRes.status === 200) {
      const t = taskRes.body as {
        description?: string;
        text_content?: string;
        attachments?: { title?: string; extension?: string; url?: string }[];
      };
      const desc = (t.description || t.text_content || "").trim();
      if (desc) parts.push(`### Descripción completa\n${truncate(desc, 6000)}`);
      const atts = t.attachments ?? [];
      if (atts.length) {
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
        const lines = atts.map((a) => {
          const isImg = imageExts.includes((a.extension || "").toLowerCase());
          return `- ${isImg ? "🖼️ imagen" : "archivo"}: ${a.title || "(sin título)"} → ${a.url || ""}`;
        });
        parts.push(
          `### Adjuntos (${atts.length})\nDescárgalos/inspecciónalos si hace falta (puedes usar curl o WebFetch):\n${lines.join("\n")}`,
        );
      }
    }

    const cmtRes = await fetchJson(`${API}/task/${externalId}/comment`, {
      headers: h,
    });
    if (cmtRes.status === 200) {
      const comments =
        (
          cmtRes.body as {
            comments?: { user?: { username?: string }; comment_text?: string }[];
          }
        )?.comments ?? [];
      if (comments.length) {
        const lines = comments
          .slice(0, 30)
          .map(
            (c) =>
              `- **${c.user?.username || "?"}**: ${(c.comment_text || "").trim()}`,
          );
        parts.push(`### Comentarios (${comments.length})\n${lines.join("\n")}`);
      }
    }

    return parts.join("\n\n");
  },
};
