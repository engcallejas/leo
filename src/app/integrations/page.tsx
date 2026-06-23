"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import { timeAgo } from "@/components/format";
import { ErrorBar, Field, Modal } from "@/components/ui";
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

  const remove = async (id: number) => {
    if (!confirm("¿Eliminar esta integración?")) return;
    await api.del(`/api/integrations/${id}`);
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

      {err && <ErrorBar text={err} />}

      {items.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            No hay integraciones. Crea una conexión a Sentry o ClickUp para
            empezar a recibir tareas.
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
                <th></th>
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
                  <td className="muted" style={{ fontSize: 12 }}>
                    {timeAgo(it.last_polled_at)}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => openEdit(it)}
                      style={{ marginRight: 6 }}
                    >
                      Editar
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(it.id)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal onClose={() => setDraft(null)} title={draft.id ? "Editar integración" : "Nueva integración"}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            </div>

            {draft.type === "sentry" ? (
              <>
                <Field
                  label="Auth token"
                  hint="Internal Integration / Auth Token con scope project:read"
                  type="password"
                  value={draft.config.token ?? ""}
                  onChange={(v) => setCfg("token", v)}
                />
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
                <Field
                  label="API token"
                  hint="ClickUp → Settings → Apps → Generate (empieza con pk_)"
                  type="password"
                  value={draft.config.token ?? ""}
                  onChange={(v) => setCfg("token", v)}
                />
                <Field
                  label="Team ID (opcional)"
                  value={draft.config.teamId ?? ""}
                  onChange={(v) => setCfg("teamId", v)}
                />
              </>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              <span style={{ fontSize: 13 }}>Activa (incluir en el polling)</span>
            </label>

            {test && (
              <div
                className={`card ${test.ok ? "badge-ok" : "badge-danger"}`}
                style={{ padding: "9px 12px", fontSize: 13 }}
              >
                {test.ok ? "✓ " : "✕ "}
                {test.message}
              </div>
            )}
            {err && <ErrorBar text={err} />}

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
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
        </Modal>
      )}
    </div>
  );
}
