"use client";

import { useState } from "react";
import type { McpServer } from "@/lib/types";

function kvToText(rec?: Record<string, string>): string {
  if (!rec) return "";
  return Object.entries(rec)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
function textToKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

export function McpEditor({
  servers,
  onChange,
  strictMcp,
  onStrictChange,
}: {
  servers: McpServer[];
  onChange: (s: McpServer[]) => void;
  strictMcp: boolean;
  onStrictChange: (v: boolean) => void;
}) {
  const update = (i: number, patch: Partial<McpServer>) =>
    onChange(servers.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(servers.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...servers,
      {
        name: "",
        transport: "stdio",
        command: "",
        args: [],
        env: {},
        planning: false,
        development: true,
      },
    ]);

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          Servidores MCP del proyecto
        </span>
        <button type="button" className="btn btn-sm" onClick={add}>
          + Agregar MCP
        </button>
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>
        Herramientas extra para mejorar outputs y validaciones. Marca dónde
        aplican: <b>planeación</b> (refinamiento, solo-lectura) y/o{" "}
        <b>desarrollo</b> (runs). Sus tools se autorizan automáticamente.
      </div>

      {servers.map((s, i) => (
        <McpRow
          key={i}
          server={s}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}

      {servers.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={strictMcp}
            onChange={(e) => onStrictChange(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>
            Estricto: usar solo estos MCP (ignorar el <code>.mcp.json</code> del
            repo)
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * One server row. The args/env/headers fields keep their own RAW text state so
 * typing isn't clobbered by the parse→object→text round-trip (e.g. typing a key
 * before the "=" must not wipe the field). The parsed value is pushed up as a
 * side-effect of each keystroke.
 */
function McpRow({
  server,
  onChange,
  onRemove,
}: {
  server: McpServer;
  onChange: (patch: Partial<McpServer>) => void;
  onRemove: () => void;
}) {
  const [argsText, setArgsText] = useState((server.args ?? []).join(" "));
  const [envText, setEnvText] = useState(kvToText(server.env));
  const [headerText, setHeaderText] = useState(kvToText(server.headers));

  return (
    <div
      className="card"
      style={{ padding: 12, marginBottom: 8, background: "var(--panel-2)" }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          className="input"
          placeholder="nombre (ej. supabase)"
          value={server.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{ flex: 1 }}
        />
        <select
          className="select"
          value={server.transport}
          onChange={(e) =>
            onChange({ transport: e.target.value as McpServer["transport"] })
          }
          style={{ width: 110 }}
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
        <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
          Quitar
        </button>
      </div>

      {server.transport === "stdio" ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label className="label">Comando</label>
              <input
                className="input"
                placeholder="npx"
                value={server.command ?? ""}
                onChange={(e) => onChange({ command: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Args (separados por espacio)</label>
              <input
                className="input"
                placeholder="-y @modelcontextprotocol/server-foo"
                value={argsText}
                onChange={(e) => {
                  setArgsText(e.target.value);
                  onChange({ args: e.target.value.split(/\s+/).filter(Boolean) });
                }}
              />
            </div>
          </div>
          <div>
            <label className="label">Env (KEY=valor por línea)</label>
            <textarea
              className="textarea"
              style={{ minHeight: 48, fontFamily: "var(--mono, monospace)", fontSize: 12.5 }}
              value={envText}
              placeholder="SUPABASE_ACCESS_TOKEN=..."
              onChange={(e) => {
                setEnvText(e.target.value);
                onChange({ env: textToKv(e.target.value) });
              }}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <label className="label">URL</label>
            <input
              className="input"
              placeholder="https://mcp.example.com/mcp"
              value={server.url ?? ""}
              onChange={(e) => onChange({ url: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Headers (KEY=valor por línea)</label>
            <textarea
              className="textarea"
              style={{ minHeight: 48, fontFamily: "var(--mono, monospace)", fontSize: 12.5 }}
              value={headerText}
              placeholder="Authorization=Bearer ..."
              onChange={(e) => {
                setHeaderText(e.target.value);
                onChange({ headers: textToKv(e.target.value) });
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={server.planning}
            onChange={(e) => onChange({ planning: e.target.checked })}
          />
          Planeación
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={server.development}
            onChange={(e) => onChange({ development: e.target.checked })}
          />
          Desarrollo
        </label>
      </div>
    </div>
  );
}
