"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Field } from "@/components/ui";
import type { Integration, ProjectSource, SourceRole } from "@/lib/types";

type Meta =
  | { type: "clickup"; lists: { id: string; name: string; path: string }[] }
  | { type: "sentry"; projects: { slug: string; name: string }[] };

type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: T };

export function SourceEditor({
  sources,
  integrations,
  onChange,
}: {
  sources: ProjectSource[];
  integrations: Integration[];
  onChange: (sources: ProjectSource[]) => void;
}) {
  const [opts, setOpts] = useState<Record<number, Loadable<Meta>>>({});
  const [statuses, setStatuses] = useState<Record<string, Loadable<string[]>>>(
    {},
  );

  const loadOpts = useCallback((intId: number) => {
    setOpts((prev) => {
      if (prev[intId]) return prev;
      return { ...prev, [intId]: { state: "loading" } };
    });
    api
      .get(`/api/integrations/${intId}/options`)
      .then((data: Meta) =>
        setOpts((p) => ({ ...p, [intId]: { state: "ok", data } })),
      )
      .catch((e: Error) =>
        setOpts((p) => ({ ...p, [intId]: { state: "error", message: e.message } })),
      );
  }, []);

  const loadStatuses = useCallback((intId: number, listId: string) => {
    if (!listId) return;
    const key = `${intId}:${listId}`;
    setStatuses((prev) => {
      if (prev[key]) return prev;
      return { ...prev, [key]: { state: "loading" } };
    });
    api
      .get(`/api/integrations/${intId}/statuses?listId=${encodeURIComponent(listId)}`)
      .then((data: string[]) =>
        setStatuses((p) => ({ ...p, [key]: { state: "ok", data } })),
      )
      .catch((e: Error) =>
        setStatuses((p) => ({
          ...p,
          [key]: { state: "error", message: e.message },
        })),
      );
  }, []);

  // Load options for every integration in use + statuses for existing lists.
  useEffect(() => {
    for (const s of sources) {
      loadOpts(s.integration_id);
      if (s.type === "clickup" && s.filter.listId) {
        loadStatuses(s.integration_id, String(s.filter.listId));
      }
    }
  }, [sources, loadOpts, loadStatuses]);

  const update = (i: number, patch: Partial<ProjectSource>) =>
    onChange(sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const setFilter = (i: number, filter: Record<string, unknown>) =>
    update(i, { filter });
  const remove = (i: number) => onChange(sources.filter((_, idx) => idx !== i));

  const addSource = () => {
    const first = integrations[0];
    if (!first) return;
    loadOpts(first.id);
    onChange([
      ...sources,
      { integration_id: first.id, type: first.type, filter: {}, role: "development" },
    ]);
  };

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
        <span style={{ fontWeight: 600, fontSize: 13 }}>Fuentes de eventos</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={addSource}
          disabled={integrations.length === 0}
        >
          + Agregar fuente
        </button>
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>
        El <b>rol</b> define qué hace cada lista: <b>Desarrollo</b> alimenta el
        auto-run; <b>Planeación</b> solo aparece en el selector de planes (no se
        ejecuta sola); <b>Ambos</b>, las dos cosas. Puedes mezclar varias listas
        de planning distintas a las de desarrollo.
      </div>
      {integrations.length === 0 && (
        <div className="hint">
          Crea una integración primero para poder enlazar fuentes.
        </div>
      )}

      {sources.map((src, i) => {
        const integ = integrations.find((x) => x.id === src.integration_id);
        const type = integ?.type ?? src.type;
        const o = opts[src.integration_id];
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
                  loadOpts(id);
                  update(i, {
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
              <select
                className="select"
                title="Rol de esta fuente"
                value={src.role ?? "development"}
                onChange={(e) => update(i, { role: e.target.value as SourceRole })}
                style={{ width: 150 }}
              >
                <option value="development">Desarrollo</option>
                <option value="planning">Planeación</option>
                <option value="both">Ambos</option>
              </select>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => remove(i)}
              >
                Quitar
              </button>
            </div>

            {type === "clickup" ? (
              <ClickUpFilter
                filter={src.filter}
                opts={o}
                statuses={
                  src.filter.listId
                    ? statuses[`${src.integration_id}:${src.filter.listId}`]
                    : undefined
                }
                onPickList={(listId) => {
                  setFilter(i, { listId, statuses: [] });
                  loadStatuses(src.integration_id, listId);
                }}
                onToggleStatus={(st, on) => {
                  const cur = Array.isArray(src.filter.statuses)
                    ? (src.filter.statuses as string[])
                    : [];
                  const next = on
                    ? [...cur, st]
                    : cur.filter((x) => x !== st);
                  setFilter(i, { ...src.filter, statuses: next });
                }}
                onManual={(patch) => setFilter(i, { ...src.filter, ...patch })}
              />
            ) : (
              <SentryFilter
                filter={src.filter}
                opts={o}
                onChange={(patch) => setFilter(i, { ...src.filter, ...patch })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClickUpFilter({
  filter,
  opts,
  statuses,
  onPickList,
  onToggleStatus,
  onManual,
}: {
  filter: Record<string, unknown>;
  opts?: Loadable<Meta>;
  statuses?: Loadable<string[]>;
  onPickList: (listId: string) => void;
  onToggleStatus: (status: string, on: boolean) => void;
  onManual: (patch: Record<string, unknown>) => void;
}) {
  const listId = (filter.listId as string) ?? "";
  const selected = Array.isArray(filter.statuses)
    ? (filter.statuses as string[])
    : [];

  const lists =
    opts?.state === "ok" && opts.data.type === "clickup" ? opts.data.lists : [];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <label className="label">Lista</label>
        {opts?.state === "loading" && (
          <div className="hint">Cargando listas…</div>
        )}
        {opts?.state === "error" || (opts?.state === "ok" && lists.length === 0) ? (
          <>
            <input
              className="input"
              placeholder="List ID (manual)"
              value={listId}
              onChange={(e) => onManual({ listId: e.target.value })}
            />
            <div className="hint" style={{ color: "var(--danger)" }}>
              No se pudieron cargar las listas
              {opts?.state === "error" ? `: ${opts.message}` : ""}. Pega el List
              ID a mano.
            </div>
          </>
        ) : (
          <select
            className="select"
            value={listId}
            onChange={(e) => onPickList(e.target.value)}
          >
            <option value="">— elige una lista —</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {l.path}
              </option>
            ))}
          </select>
        )}
      </div>

      {listId && (
        <div>
          <label className="label">
            Estados a traer (sin marcar = todas las no cerradas)
          </label>
          {!statuses || statuses.state === "loading" ? (
            <div className="hint">Cargando estados…</div>
          ) : statuses.state === "error" ? (
            <input
              className="input"
              placeholder="estados separados por coma"
              value={selected.join(", ")}
              onChange={(e) =>
                onManual({
                  statuses: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {statuses.data.map((st) => (
                <label
                  key={st}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "3px 10px",
                    cursor: "pointer",
                    background: selected.includes(st)
                      ? "var(--panel)"
                      : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(st)}
                    onChange={(e) => onToggleStatus(st, e.target.checked)}
                  />
                  {st}
                </label>
              ))}
              {statuses.data.length === 0 && (
                <span className="hint">Esta lista no tiene estados.</span>
              )}
            </div>
          )}
        </div>
      )}

      {listId && statuses?.state === "ok" && statuses.data.length > 0 && (
        <div>
          <label className="label">Estado al completar (mover la tarea a)</label>
          <select
            className="select"
            value={(filter.doneStatus as string) ?? ""}
            onChange={(e) => onManual({ doneStatus: e.target.value })}
          >
            <option value="">— no mover —</option>
            {statuses.data.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <div className="hint">
            Si “marcar el issue como resuelto” está activo, al terminar con éxito
            la tarea pasa a este estado.
          </div>
        </div>
      )}
    </div>
  );
}

function SentryFilter({
  filter,
  opts,
  onChange,
}: {
  filter: Record<string, unknown>;
  opts?: Loadable<Meta>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const projectSlug = (filter.projectSlug as string) ?? "";
  const projects =
    opts?.state === "ok" && opts.data.type === "sentry"
      ? opts.data.projects
      : [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div>
        <label className="label">Proyecto</label>
        {opts?.state === "loading" && <div className="hint">Cargando…</div>}
        {opts?.state === "error" ||
        (opts?.state === "ok" && projects.length === 0) ? (
          <input
            className="input"
            placeholder="project slug (manual)"
            value={projectSlug}
            onChange={(e) => onChange({ projectSlug: e.target.value })}
          />
        ) : (
          <select
            className="select"
            value={projectSlug}
            onChange={(e) => onChange({ projectSlug: e.target.value })}
          >
            <option value="">— elige un proyecto —</option>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        )}
      </div>
      <Field
        label="Query"
        value={(filter.query as string) ?? ""}
        onChange={(v) => onChange({ query: v })}
        placeholder="is:unresolved"
      />
    </div>
  );
}
