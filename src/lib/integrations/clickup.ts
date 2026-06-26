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

    const taskRes = await fetchJson(
      `${API}/task/${externalId}?include_subtasks=true`,
      { headers: h },
    );
    if (taskRes.status === 200) {
      const t = taskRes.body as {
        description?: string;
        text_content?: string;
        attachments?: { title?: string; extension?: string; url?: string }[];
        subtasks?: {
          id?: string;
          name?: string;
          status?: { status?: string };
        }[];
      };
      const subs = t.subtasks ?? [];
      if (subs.length) {
        const lines = subs.map(
          (s, i) =>
            `${i + 1}. [${s.status?.status ?? "?"}] ${s.name ?? "(sin título)"} (id ${s.id})`,
        );
        parts.push(
          `### Subtareas (${subs.length})\nEsta tarea tiene subtareas. Considéralas como el desglose del trabajo:\n${lines.join("\n")}`,
        );
      }
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

  async createTask(raw, listId, input): Promise<{ id: string; url: string | null }> {
    const config = raw as unknown as ClickUpConfig;
    const body: Record<string, unknown> = { name: input.name };
    if (input.description) body.description = input.description;
    if (input.parentId) body.parent = input.parentId;
    const { status, body: res } = await fetchJson(`${API}/list/${listId}/task`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify(body),
    });
    if (status === 200) {
      const t = res as { id?: string; url?: string };
      if (t.id) return { id: t.id, url: t.url ?? null };
    }
    throw new Error(
      `ClickUp create task ${status}: ${truncate(JSON.stringify(res), 200)}`,
    );
  },

  async addComment(raw, externalId, text): Promise<ProviderTestResult> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(
      `${API}/task/${externalId}/comment`,
      {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ comment_text: text, notify_all: false }),
      },
    );
    if (status === 200) return { ok: true, message: "Comentario publicado." };
    return {
      ok: false,
      message: `ClickUp comment ${status}: ${truncate(JSON.stringify(body), 150)}`,
    };
  },

  async getTaskMeta(raw, externalId): Promise<{ listId: string | null; url: string | null }> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(`${API}/task/${externalId}`, {
      headers: headers(config),
    });
    if (status === 200) {
      const t = body as { url?: string; list?: { id?: string } };
      return { listId: t.list?.id ?? null, url: t.url ?? null };
    }
    return { listId: null, url: null };
  },

  async getTaskDescription(raw, externalId): Promise<string> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(
      `${API}/task/${externalId}?include_markdown_description=true`,
      { headers: headers(config) },
    );
    if (status === 200) {
      const t = body as { markdown_description?: string; description?: string };
      return (t.markdown_description || t.description || "").trim();
    }
    return "";
  },

  async fetchTaskSeed(
    raw,
    externalId,
  ): Promise<{ title: string; objective: string; url: string | null } | null> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(
      `${API}/task/${externalId}?include_markdown_description=true`,
      { headers: headers(config) },
    );
    if (status !== 200) return null;
    const t = body as {
      name?: string;
      markdown_description?: string;
      description?: string;
      url?: string;
    };
    return {
      title: (t.name || "").trim(),
      objective: (t.markdown_description || t.description || "").trim(),
      url: t.url ?? null,
    };
  },

  async fetchTaskState(
    raw,
    externalId,
  ): Promise<{ status: string; type: string; url: string | null } | null> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(`${API}/task/${externalId}`, {
      headers: headers(config),
    });
    if (status !== 200) return null;
    const t = body as {
      status?: { status?: string; type?: string };
      url?: string;
    };
    return {
      status: (t.status?.status || "").trim(),
      type: (t.status?.type || "").trim().toLowerCase(),
      url: t.url ?? null,
    };
  },

  async uploadAttachment(raw, externalId, filename, data): Promise<ProviderTestResult> {
    const config = raw as unknown as ClickUpConfig;
    const form = new FormData();
    // Buffer → Uint8Array for a Web Blob (Node 20 global Blob/FormData/fetch).
    form.append(
      "attachment",
      new Blob([new Uint8Array(data)]),
      filename,
    );
    try {
      const res = await fetch(`${API}/task/${externalId}/attachment`, {
        method: "POST",
        headers: { Authorization: config.token }, // do NOT set Content-Type
        body: form,
      });
      if (res.ok) return { ok: true, message: `Adjunto "${filename}" subido.` };
      return {
        ok: false,
        message: `ClickUp attachment ${res.status}: ${truncate(await res.text(), 150)}`,
      };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async fetchAttachments(raw, externalId): Promise<{ title: string; extension: string; url: string; mimetype: string }[]> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(`${API}/task/${externalId}`, {
      headers: headers(config),
    });
    if (status !== 200) return [];
    const atts =
      (body as {
        attachments?: {
          title?: string;
          extension?: string;
          url?: string;
          mimetype?: string;
        }[];
      })?.attachments ?? [];
    return atts
      .filter((a) => a.url)
      .map((a) => ({
        title: a.title ?? "attachment",
        extension: (a.extension ?? "").toLowerCase(),
        url: a.url as string,
        mimetype: a.mimetype ?? "",
      }));
  },

  async fetchSubtasks(raw, externalId): Promise<{ id: string; name: string; url: string | null }[]> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(
      `${API}/task/${externalId}?include_subtasks=true`,
      { headers: headers(config) },
    );
    if (status !== 200) return [];
    const subs =
      (body as {
        subtasks?: { id?: string; name?: string; url?: string; orderindex?: string }[];
      })?.subtasks ?? [];
    return subs
      .filter((s) => s.id)
      .sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0))
      .map((s) => ({ id: String(s.id), name: s.name ?? `Subtask ${s.id}`, url: s.url ?? null }));
  },

  async updateTaskDescription(raw, externalId, markdown): Promise<ProviderTestResult> {
    const config = raw as unknown as ClickUpConfig;
    const { status, body } = await fetchJson(`${API}/task/${externalId}`, {
      method: "PUT",
      headers: headers(config),
      body: JSON.stringify({ markdown_content: markdown }),
    });
    if (status === 200) {
      return { ok: true, message: "Descripción de la tarea ClickUp actualizada." };
    }
    return {
      ok: false,
      message: `ClickUp PUT descripción ${status}: ${truncate(JSON.stringify(body), 150)}`,
    };
  },
};
