"use client";

import { useState } from "react";
import { FolderPicker } from "@/components/FolderPicker";
import { Field } from "@/components/ui";
import type {
  Integration,
  PermissionMode,
  Project,
  ProjectSource,
} from "@/lib/types";

export type Draft = {
  id?: number;
  name: string;
  repo_path: string;
  base_branch: string;
  target_branch: string;
  prompt_rules: string;
  auto_mode: boolean;
  permission_mode: PermissionMode;
  allowed_tools: string;
  disallowed_tools: string;
  model: string;
  max_turns: string;
  sources: ProjectSource[];
  enabled: boolean;
  resolve_source_on_done: boolean;
};

export function emptyDraft(): Draft {
  return {
    name: "",
    repo_path: "",
    base_branch: "main",
    target_branch: "",
    prompt_rules:
      "PUEDE: refactorizar y crear archivos dentro de este repo.\nDEBE: seguir el CLAUDE.md, correr los tests/validaciones y dejarlos en verde.\nNO PUEDE: tocar variables de entorno de producción ni borrar migraciones.\nNO DEBE: hacer cambios fuera del alcance de la tarea.",
    auto_mode: false,
    permission_mode: "acceptEdits",
    allowed_tools: "",
    disallowed_tools: "",
    model: "",
    max_turns: "",
    sources: [],
    enabled: true,
    resolve_source_on_done: true,
  };
}

export function projectToDraft(p: Project): Draft {
  return {
    id: p.id,
    name: p.name,
    repo_path: p.repo_path,
    base_branch: p.base_branch,
    target_branch: p.target_branch,
    prompt_rules: p.prompt_rules,
    auto_mode: p.auto_mode,
    permission_mode: p.permission_mode,
    allowed_tools: p.allowed_tools ?? "",
    disallowed_tools: p.disallowed_tools ?? "",
    model: p.model ?? "",
    max_turns: p.max_turns ? String(p.max_turns) : "",
    sources: p.sources,
    enabled: p.enabled,
    resolve_source_on_done: p.resolve_source_on_done,
  };
}

export function draftToBody(draft: Draft) {
  return {
    name: draft.name,
    repo_path: draft.repo_path,
    base_branch: draft.base_branch,
    target_branch: draft.target_branch,
    prompt_rules: draft.prompt_rules,
    auto_mode: draft.auto_mode,
    permission_mode: draft.permission_mode,
    allowed_tools: draft.allowed_tools || null,
    disallowed_tools: draft.disallowed_tools || null,
    model: draft.model || null,
    max_turns: draft.max_turns ? Number(draft.max_turns) : null,
    sources: draft.sources,
    enabled: draft.enabled,
    resolve_source_on_done: draft.resolve_source_on_done,
  };
}

const PROMPT_PLACEHOLDER = `Reglas del proyecto (puede / debe / no puede / no debe).
Ej:
- Al terminar, crea commit + push a la branch destino y abre PR.
- Garantiza que los pasos del PR (checks) pasen.
- Solo puede acceder al proyecto Supabase "staging" vía el MCP.`;

export function ProjectForm({
  draft,
  setDraft,
  integrations,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  integrations: Integration[];
}) {
  const [picker, setPicker] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft({ ...draft, [k]: v });

  const addSource = () => {
    const first = integrations[0];
    if (!first) return;
    set("sources", [
      ...draft.sources,
      { integration_id: first.id, type: first.type, filter: {} },
    ]);
  };

  const updateSource = (i: number, patch: Partial<ProjectSource>) => {
    const next = draft.sources.slice();
    next[i] = { ...next[i], ...patch };
    set("sources", next);
  };
  const updateFilter = (i: number, key: string, value: unknown) => {
    const next = draft.sources.slice();
    next[i] = { ...next[i], filter: { ...next[i].filter, [key]: value } };
    set("sources", next);
  };
  const removeSource = (i: number) =>
    set(
      "sources",
      draft.sources.filter((_, idx) => idx !== i),
    );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Field
        label="Nombre"
        value={draft.name}
        onChange={(v) => set("name", v)}
        placeholder="Ej. API Pagos"
      />
      <div>
        <label className="label">Ruta local del repo</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            value={draft.repo_path}
            placeholder="/Users/tu-usuario/repos/api-pagos"
            onChange={(e) => set("repo_path", e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setPicker(true)}
            style={{ whiteSpace: "nowrap" }}
          >
            📁 Examinar
          </button>
        </div>
        <div className="hint">
          Claude se ejecuta con esta carpeta como cwd → respeta su CLAUDE.md y
          .mcp.json
        </div>
      </div>
      {picker && (
        <FolderPicker
          initialPath={draft.repo_path || undefined}
          onSelect={(p) => {
            set("repo_path", p);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field
          label="Branch base"
          value={draft.base_branch}
          onChange={(v) => set("base_branch", v)}
          placeholder="main"
        />
        <Field
          label="Branch destino (PR)"
          value={draft.target_branch}
          onChange={(v) => set("target_branch", v)}
          placeholder="leo/automated"
        />
      </div>

      <div>
        <label className="label">Reglas del proyecto (prompt)</label>
        <textarea
          className="textarea"
          style={{ minHeight: 130 }}
          value={draft.prompt_rules}
          placeholder={PROMPT_PLACEHOLDER}
          onChange={(e) => set("prompt_rules", e.target.value)}
        />
        <div className="hint">
          Se inyecta en cada ejecución como reglas de puede / debe / no puede /
          no debe.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="label">Modo de permisos</label>
          <select
            className="select"
            value={draft.permission_mode}
            onChange={(e) =>
              set("permission_mode", e.target.value as PermissionMode)
            }
          >
            <option value="default">default (pide permiso → puede colgarse)</option>
            <option value="acceptEdits">acceptEdits (auto-aprueba ediciones)</option>
            <option value="plan">plan (solo planifica)</option>
            <option value="bypassPermissions">
              bypassPermissions (autónomo total)
            </option>
          </select>
          <div className="hint">
            Para auto-mode usa acceptEdits o bypassPermissions (sin TTY no se
            pueden responder permisos).
          </div>
        </div>
        <Field
          label="Modelo (opcional)"
          value={draft.model}
          onChange={(v) => set("model", v)}
          placeholder="claude-opus-4-8"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field
          label="allowedTools (opcional, coma)"
          value={draft.allowed_tools}
          onChange={(v) => set("allowed_tools", v)}
          placeholder="Edit,Bash,mcp__supabase"
        />
        <Field
          label="disallowedTools (opcional, coma)"
          value={draft.disallowed_tools}
          onChange={(v) => set("disallowed_tools", v)}
          placeholder="Bash(rm*)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field
          label="Máx. turnos (opcional)"
          value={draft.max_turns}
          onChange={(v) => set("max_turns", v.replace(/[^0-9]/g, ""))}
          placeholder="sin límite"
        />
        <div style={{ display: "flex", alignItems: "end", gap: 18 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={draft.auto_mode}
              onChange={(e) => set("auto_mode", e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>Auto-mode</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            <span style={{ fontSize: 13 }}>Habilitado</span>
          </label>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={draft.resolve_source_on_done}
            onChange={(e) => set("resolve_source_on_done", e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>
            Al terminar con éxito, marcar el issue de origen como resuelto
          </span>
        </label>
        <div className="hint">
          Sentry: marca el issue como <code>resolved</code> cuando el run termina
          bien (p. ej. tras abrir el PR). Solo aplica a tareas que vienen de una
          integración.
        </div>
      </div>

      {/* Sources */}
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
            Fuentes de eventos
          </span>
          <button
            className="btn btn-sm"
            onClick={addSource}
            disabled={integrations.length === 0}
          >
            + Agregar fuente
          </button>
        </div>
        {integrations.length === 0 && (
          <div className="hint">
            Crea una integración primero para poder enlazar fuentes.
          </div>
        )}
        {draft.sources.map((src, i) => {
          const integ = integrations.find((x) => x.id === src.integration_id);
          const type = integ?.type ?? src.type;
          return (
            <div
              key={i}
              className="card"
              style={{ padding: 12, marginBottom: 8, background: "var(--panel-2)" }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <select
                  className="select"
                  value={src.integration_id}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const it = integrations.find((x) => x.id === id);
                    updateSource(i, {
                      integration_id: id,
                      type: it?.type ?? src.type,
                      filter: {},
                    });
                  }}
                  style={{ flex: 1 }}
                >
                  {integrations.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.type})
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => removeSource(i)}
                >
                  Quitar
                </button>
              </div>

              {type === "sentry" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field
                    label="Project slug"
                    value={(src.filter.projectSlug as string) ?? ""}
                    onChange={(v) => updateFilter(i, "projectSlug", v)}
                    placeholder="frontend"
                  />
                  <Field
                    label="Query"
                    value={(src.filter.query as string) ?? ""}
                    onChange={(v) => updateFilter(i, "query", v)}
                    placeholder="is:unresolved"
                  />
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field
                    label="List ID"
                    value={(src.filter.listId as string) ?? ""}
                    onChange={(v) => updateFilter(i, "listId", v)}
                    placeholder="901234567"
                  />
                  <Field
                    label="Estados (coma, opcional)"
                    value={
                      Array.isArray(src.filter.statuses)
                        ? (src.filter.statuses as string[]).join(", ")
                        : ""
                    }
                    onChange={(v) =>
                      updateFilter(
                        i,
                        "statuses",
                        v
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="to do, listo para dev"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
