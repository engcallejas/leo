"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import type { RunInteraction } from "@/lib/types";

export function RunInteractions({
  runId,
  active,
}: {
  runId: number;
  active: boolean;
}) {
  const [items, setItems] = useState<RunInteraction[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const all: RunInteraction[] = await api.get(
        `/api/runs/${runId}/interactions`,
      );
      setItems(all);
    } catch {
      /* ignore */
    }
  }, [runId]);

  useEffect(() => {
    load();
    if (!active) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load, active]);

  const answer = async (id: number, text: string) => {
    if (!text.trim()) return;
    setBusy(id);
    try {
      await api.post(`/api/interactions/${id}/answer`, { answer: text });
      await load();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  const pending = items.filter((i) => i.status === "pending");
  if (pending.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
      {pending.map((it) => (
        <div
          key={it.id}
          className="card"
          style={{
            padding: 16,
            border: "1px solid var(--warn, #b58900)",
            background: "var(--panel-2)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span className="badge badge-warn badge-dot">
              {it.kind === "approval" ? "Aprobación" : "Pregunta"} de Claude
            </span>
          </div>
          <div
            style={{
              fontSize: 14,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              marginBottom: 12,
            }}
          >
            {it.question}
          </div>

          {it.kind === "approval" ? (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-primary"
                disabled={busy === it.id}
                onClick={() => answer(it.id, "approved")}
              >
                Aprobar
              </button>
              <button
                className="btn btn-danger"
                disabled={busy === it.id}
                onClick={() => answer(it.id, "denied")}
              >
                Rechazar
              </button>
            </div>
          ) : (
            <>
              {it.options.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                  {it.options.map((o) => (
                    <button
                      key={o}
                      className="btn btn-sm"
                      disabled={busy === it.id}
                      onClick={() => answer(it.id, o)}
                      style={{
                        justifyContent: "flex-start",
                        textAlign: "left",
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        height: "auto",
                        lineHeight: 1.45,
                        padding: "8px 11px",
                      }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  placeholder="Escribe tu respuesta…"
                  value={draft[it.id] ?? ""}
                  disabled={busy === it.id}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [it.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") answer(it.id, draft[it.id] ?? "");
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy === it.id || !(draft[it.id] ?? "").trim()}
                  onClick={() => answer(it.id, draft[it.id] ?? "")}
                >
                  Responder
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
