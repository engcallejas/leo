import type { PulledItem, SentryConfig, SentrySourceFilter } from "../types";
import {
  fetchJson,
  truncate,
  type IntegrationProvider,
  type ProviderTestResult,
} from "./provider";

function baseUrl(config: SentryConfig): string {
  return (config.baseUrl || "https://sentry.io").replace(/\/+$/, "");
}

function headers(config: SentryConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
}

interface SentryIssue {
  id: string;
  title?: string;
  culprit?: string;
  permalink?: string;
  level?: string;
  count?: string;
  userCount?: number;
  lastSeen?: string;
  firstSeen?: string;
  status?: string;
  shortId?: string;
  metadata?: { value?: string; type?: string };
}

export const sentryProvider: IntegrationProvider = {
  type: "sentry",

  async testConnection(raw): Promise<ProviderTestResult> {
    const config = raw as unknown as SentryConfig;
    if (!config.token) return { ok: false, message: "Falta el token de Sentry." };
    if (!config.org) return { ok: false, message: "Falta el organization slug." };
    const { status, body } = await fetchJson(
      `${baseUrl(config)}/api/0/organizations/${config.org}/`,
      { headers: headers(config) },
    );
    if (status === 200) {
      const name = (body as { name?: string })?.name ?? config.org;
      return { ok: true, message: `Conectado a la organización "${name}".` };
    }
    if (status === 401)
      return { ok: false, message: "Token inválido o sin permisos (401)." };
    if (status === 404)
      return { ok: false, message: `Organización "${config.org}" no encontrada (404).` };
    return { ok: false, message: `Sentry respondió ${status}.` };
  },

  async poll(raw, rawFilter): Promise<PulledItem[]> {
    const config = raw as unknown as SentryConfig;
    const filter = rawFilter as unknown as SentrySourceFilter;
    const base = baseUrl(config);
    const h = headers(config);
    const query = encodeURIComponent(filter.query || "is:unresolved");

    // Use the org-level issues endpoint (modern, and lenient on dedicated
    // subdomains). Resolve the project slug -> numeric id to scope results.
    let projectParam = "";
    if (filter.projectSlug) {
      const projRes = await fetchJson(
        `${base}/api/0/organizations/${config.org}/projects/`,
        { headers: h },
      );
      if (projRes.status === 200 && Array.isArray(projRes.body)) {
        const list = projRes.body as { slug: string; id: string }[];
        const match = list.find((p) => p.slug === filter.projectSlug);
        if (match) {
          projectParam = `&project=${match.id}`;
        } else {
          throw new Error(
            `Proyecto Sentry "${filter.projectSlug}" no encontrado. Slugs disponibles: ${list
              .map((p) => p.slug)
              .join(", ")}`,
          );
        }
      }
    }

    const url = `${base}/api/0/organizations/${config.org}/issues/?query=${query}&statsPeriod=14d&limit=25${projectParam}`;
    const { status, body } = await fetchJson(url, { headers: h });
    if (status !== 200) {
      const snippet =
        typeof body === "string"
          ? body.trim().startsWith("<")
            ? "(Sentry devolvió una página de error HTML — revisa el org slug)"
            : body.slice(0, 200)
          : JSON.stringify(body).slice(0, 200);
      throw new Error(`Sentry issues ${status}: ${snippet}`);
    }
    const issuesList = (body as SentryIssue[]) ?? [];
    return issuesList.map((issue) => {
      const title = issue.title || issue.metadata?.value || `Issue ${issue.id}`;
      const lines = [
        `Sentry issue ${issue.shortId ?? issue.id} (${issue.level ?? "error"})`,
        issue.culprit ? `Culprit: ${issue.culprit}` : "",
        issue.metadata?.value ? `Message: ${issue.metadata.value}` : "",
        issue.count ? `Events: ${issue.count}` : "",
        issue.userCount ? `Users affected: ${issue.userCount}` : "",
        issue.firstSeen ? `First seen: ${issue.firstSeen}` : "",
        issue.lastSeen ? `Last seen: ${issue.lastSeen}` : "",
        issue.permalink ? `Permalink: ${issue.permalink}` : "",
      ].filter(Boolean);
      return {
        external_id: issue.id,
        title: truncate(title, 200),
        description: truncate(lines.join("\n")),
        url: issue.permalink ?? null,
        raw: issue,
      } satisfies PulledItem;
    });
  },

  async resolveTask(raw, externalId): Promise<ProviderTestResult> {
    const config = raw as unknown as SentryConfig;
    const { status, body } = await fetchJson(
      `${baseUrl(config)}/api/0/organizations/${config.org}/issues/${externalId}/`,
      {
        method: "PUT",
        headers: headers(config),
        body: JSON.stringify({ status: "resolved" }),
      },
    );
    if (status === 200) {
      return {
        ok: true,
        message: `Issue ${externalId} marcado como resuelto en Sentry.`,
      };
    }
    return {
      ok: false,
      message: `Sentry resolve respondió ${status}: ${truncate(
        JSON.stringify(body),
        200,
      )}`,
    };
  },
};
