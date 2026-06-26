"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import { timeAgo } from "@/components/format";
import { ErrorBar, Field, useConfirm } from "@/components/ui";
import type { Integration, IntegrationType } from "@/lib/types";

type Draft = {
  id?: number;
  type: IntegrationType;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
};

const EMPTY: Draft = {
  type: "sentry",
  name: "",
  config: {},
  enabled: true,
};

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    setItems(await api.get("/api/integrations"));
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [load]);

  const openNew = () => {
    setTest(null);
    setErr(null);
    setDraft({ ...EMPTY, config: {} });
  };
  const openEdit = (it: Integration) => {
    setTest(null);
    setErr(null);
    setDraft({
      id: it.id,
      type: it.type,
      name: it.name,
      config: { ...(it.config as unknown as Record<string, string>) },
      enabled: it.enabled,
    });
  };

  const save = async () => {
    if (!draft) return;
    setErr(null);
    try {
      const body = {
        type: draft.type,
        name: draft.name,
        config: draft.config,
        enabled: draft.enabled,
      };
      if (draft.id) await api.put(`/api/integrations/${draft.id}`, body);
      else await api.post("/api/integrations", body);
      setDraft(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const runTest = async () => {
    if (!draft) return;
    setTesting(true);
    setTest(null);
    try {
      const res = await api.post("/api/integrations/test", {
        type: draft.type,
        config: draft.config,
      });
      setTest(res);
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const remove = async (it: Integration) => {
    if (
      !(await confirm({
        title: "¿Eliminar integración?",
        body: it.name,
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    await api.del(`/api/integrations/${it.id}`);
    await load();
  };

  const setCfg = (k: string, v: string) =>
    setDraft((d) => (d ? { ...d, config: { ...d.config, [k]: v } } : d));

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <Header
        title="Integraciones"
        subtitle="Conexiones de origen (pull) que generan tareas: Sentry y ClickUp"
        right={
          <button className="btn btn-primary" onClick={openNew}>
            + Nueva integración
          </button>
        }
      />

      {err && !draft && <ErrorBar text={err} />}

      {draft && (
        <div className="card" style={{ padding: 22, marginBottom: 16 }}>
          <div
            className="sec-title"
            style={{ fontSize: 16, marginBottom: 18 }}
          >
            {draft.id ? "Editar integración" : "Nueva integración"}
          </div>
          <div className="form-grid">
            <div>
              <label className="label">Tipo</label>
              <select
                className="select"
                value={draft.type}
                disabled={!!draft.id}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    type: e.target.value as IntegrationType,
                    config: {},
                  })
                }
              >
                <option value="sentry">Sentry</option>
                <option value="clickup">ClickUp</option>
              </select>
            </div>
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={draft.name}
                placeholder="Ej. Sentry — Producción"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            {draft.type === "sentry" ? (
              <>
                <div className="span-2">
                  <Field
                    label="Auth token"
                    hint="Internal Integration / Auth Token con scope project:read"
                    type="password"
                    value={draft.config.token ?? ""}
                    onChange={(v) => setCfg("token", v)}
                  />
                </div>
                <Field
                  label="Organization slug"
                  value={draft.config.org ?? ""}
                  placeholder="mi-org"
                  onChange={(v) => setCfg("org", v)}
                />
                <Field
                  label="Base URL (opcional, self-hosted)"
                  value={draft.config.baseUrl ?? ""}
                  placeholder="https://sentry.io"
                  onChange={(v) => setCfg("baseUrl", v)}
                />
              </>
            ) : (
              <>
                <div className="span-2">
                  <Field
                    label="API token"
                    hint="ClickUp → Settings → Apps → Generate (empieza con pk_)"
                    type="password"
                    value={draft.config.token ?? ""}
                    onChange={(v) => setCfg("token", v)}
                  />
                </div>
                <Field
                  label="Team ID (opcional)"
                  value={draft.config.teamId ?? ""}
                  onChange={(v) => setCfg("teamId", v)}
                />
              </>
            )}

            <div style={{ alignSelf: "end" }}>
              <label className="label">Estado</label>
              <label
                className="input"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) =>
                    setDraft({ ...draft, enabled: e.target.checked })
                  }
                />
                <span style={{ fontSize: 13 }}>
                  Activa (incluir en el polling)
                </span>
              </label>
            </div>

            {test && (
              <div
                className={`span-2 badge ${test.ok ? "badge-ok" : "badge-danger"}`}
                style={{
                  display: "flex",
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                {test.ok ? "✓ " : "✕ "}
                {test.message}
              </div>
            )}
            {err && (
              <div className="span-2">
                <ErrorBar text={err} />
              </div>
            )}

            <div
              className="span-2"
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "space-between",
                alignItems: "center",
                borderTop: "1px solid var(--border)",
                marginTop: 4,
                paddingTop: 18,
              }}
            >
              <button className="btn" onClick={runTest} disabled={testing}>
                {testing ? "Probando…" : "Probar conexión"}
              </button>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" onClick={() => setDraft(null)}>
                  Cancelar
                </button>
                <button
                  className="btn btn-primary"
                  onClick={save}
                  disabled={!draft.name || !draft.config.token}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 40,
            textAlign: "center",
            display: "grid",
            gap: 6,
            placeItems: "center",
          }}
        >
          <div className="ed-display" style={{ fontSize: 18 }}>
            Sin integraciones
          </div>
          <div className="muted" style={{ maxWidth: 380 }}>
            Crea una conexión a Sentry o ClickUp para empezar a recibir tareas.
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Último poll</th>
                <th aria-label="Acciones"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td style={{ fontWeight: 600 }}>{it.name}</td>
                  <td>
                    <span className="badge">{it.type}</span>
                  </td>
                  <td>
                    {it.last_error ? (
                      <span
                        className="badge badge-danger badge-dot"
                        title={it.last_error}
                      >
                        error
                      </span>
                    ) : it.enabled ? (
                      <span className="badge badge-ok badge-dot">activa</span>
                    ) : (
                      <span className="badge badge-dot">pausada</span>
                    )}
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }}>
                    {timeAgo(it.last_polled_at)}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        className="btn btn-sm"
                        onClick={() => openEdit(it)}
                      >
                        Editar
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => remove(it)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog}
    </div>
  );
}
