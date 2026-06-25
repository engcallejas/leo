import fs from "fs";
import path from "path";
import { LOGS_DIR, UPLOADS_DIR } from "../db";
import type { McpServer, Project } from "../types";

/** A prompt block pointing Claude at uploaded images it can read with Read. */
export function buildAttachmentBlock(
  attachments: { filename: string; mime: string | null; path: string }[],
  heading = "## Imágenes adjuntas",
): string {
  if (!attachments.length) return "";
  const lines = attachments.map(
    (a) => `- ${a.filename}${a.mime ? ` (${a.mime})` : ""}: ${a.path}`,
  );
  return `${heading}\nEl usuario adjuntó estas imágenes (mockups, capturas, referencias). Léelas con la tool Read usando su ruta absoluta para entender el diseño/objetivo esperado:\n${lines.join("\n")}`;
}

/** Absolute path to the bundled Leo MCP server (ask_user / request_approval). */
function leoMcpScriptPath(): string {
  return path.join(process.cwd(), "scripts", "leo-mcp-server.mjs");
}

function leoBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.LEO_BASE_URL || `http://127.0.0.1:${port}`;
}

function serverToConfig(s: McpServer): Record<string, unknown> {
  if (s.transport === "stdio") {
    return {
      command: s.command,
      ...(s.args && s.args.length ? { args: s.args } : {}),
      ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}),
    };
  }
  return {
    type: s.transport,
    url: s.url,
    ...(s.headers && Object.keys(s.headers).length ? { headers: s.headers } : {}),
  };
}

export interface RunExtras {
  /** Extra CLI args to append (--mcp-config / --settings / --strict-mcp-config). */
  args: string[];
  /** MCP tool prefixes to add to --allowedTools (e.g. mcp__supabase). */
  allowedMcpTools: string[];
}

/**
 * Build the per-run MCP config + settings (hooks) files and the matching CLI
 * args. `scope` selects which project MCP servers apply. When `interactiveRunId`
 * is set, the Leo ask_user MCP is injected too (dev runs).
 */
export function buildRunExtras(opts: {
  project: Project;
  scope: "planning" | "development";
  baseName: string; // e.g. "run-12" or "plan-refine-3"
  /** Dev run id to route Leo ask_user questions to. */
  interactiveRunId?: number;
  /** Plan id to route Leo ask_user questions to (refinement). */
  interactivePlanId?: number;
}): RunExtras {
  const { project, scope, baseName, interactiveRunId, interactivePlanId } = opts;
  const args: string[] = [];
  const allowedMcpTools: string[] = [];

  const servers = (project.mcp_servers ?? []).filter((s) =>
    scope === "planning" ? s.planning : s.development,
  );
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (!s.name) continue;
    mcpServers[s.name] = serverToConfig(s);
    allowedMcpTools.push(`mcp__${s.name}`);
  }

  // Inject the Leo MCP for interactive runs/refinements (Claude asks the human).
  // Dev runs route to /api/runs/<id>/interactions; refinements to the plan
  // endpoint. Interactions are polled by id, so the answer path is shared.
  const leoEnv: Record<string, string> | null = interactiveRunId
    ? {
        LEO_BASE_URL: leoBaseUrl(),
        LEO_RUN_ID: String(interactiveRunId),
        LEO_INTERACTIONS_PATH: `/api/runs/${interactiveRunId}/interactions`,
        LEO_NOTES_PATH: `/api/runs/${interactiveRunId}/notes/consume`,
      }
    : interactivePlanId
      ? {
          LEO_BASE_URL: leoBaseUrl(),
          LEO_INTERACTIONS_PATH: `/api/plans/${interactivePlanId}/interactions`,
        }
      : null;
  if (leoEnv && project.interactive) {
    const script = leoMcpScriptPath();
    if (fs.existsSync(script)) {
      mcpServers["leo"] = {
        command: process.execPath, // node
        args: [script],
        env: leoEnv,
      };
      allowedMcpTools.push("mcp__leo");
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    const mcpPath = path.join(LOGS_DIR, `${baseName}.mcp.json`);
    try {
      fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers }, null, 2));
      args.push("--mcp-config", mcpPath);
      if (project.strict_mcp) args.push("--strict-mcp-config");
    } catch {
      /* if we can't write, skip MCP rather than fail the run */
    }
  }

  // Allow Claude to read uploaded plan attachments (mockups/screenshots) via the
  // Read tool, in both planning and dev runs.
  try {
    if (fs.existsSync(UPLOADS_DIR)) args.push("--add-dir", UPLOADS_DIR);
  } catch {
    /* ignore */
  }

  // Hooks via a settings file (dev runs only — planning is read-only analysis).
  // We merge the project's own hooks with Leo's steering hooks, which PUSH any
  // queued human notes into the run at every tool boundary and gate the agent
  // from finishing while steering is still undelivered. This makes note delivery
  // reliable instead of relying on the agent calling the check_in MCP tool.
  if (scope === "development") {
    const hooks: Record<string, unknown[]> = {};
    if (project.hooks && project.hooks.trim()) {
      try {
        const parsed = JSON.parse(project.hooks) as Record<string, unknown>;
        for (const [evt, arr] of Object.entries(parsed)) {
          if (Array.isArray(arr)) hooks[evt] = [...arr];
        }
      } catch {
        /* invalid hooks JSON → ignore (validated in the UI) */
      }
    }
    if (interactiveRunId) {
      const hookScript = path.join(process.cwd(), "scripts", "leo-steering-hook.mjs");
      if (fs.existsSync(hookScript)) {
        const cmd = `"${process.execPath}" "${hookScript}" ${interactiveRunId} "${leoBaseUrl()}"`;
        const entry = { hooks: [{ type: "command", command: cmd }] };
        (hooks.PostToolUse ??= []).push({ matcher: "", ...entry });
        (hooks.Stop ??= []).push(entry);
      }
    }
    if (Object.keys(hooks).length > 0) {
      try {
        const settingsPath = path.join(LOGS_DIR, `${baseName}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2));
        args.push("--settings", settingsPath);
      } catch {
        /* ignore — better to run without hooks than to fail the run */
      }
    }
  }

  return { args, allowedMcpTools };
}

/** Merge a project's allowed_tools with MCP tool prefixes into one CLI value. */
export function mergeAllowedTools(
  base: string | null,
  mcpTools: string[],
): string | null {
  const parts = [
    ...(base ? base.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ...mcpTools,
  ];
  return parts.length ? parts.join(",") : null;
}
