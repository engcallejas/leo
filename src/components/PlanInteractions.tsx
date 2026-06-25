"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import type { RunInteraction } from "@/lib/types";

/**
 * Pending questions Claude raised during a plan's refinement (via the Leo
 * ask_user MCP). Polls while the plan is refining; answering unblocks the
 * waiting refinement so it can continue with the human's input.
 */
export function PlanInteractions({
  planId,
  active,
}: {
  planId: number;
  active: boolean;
}) {
  const [items, setItems] = useState<RunInteraction[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const all: RunInteraction[] = await api.get(
        `/api/plans/${planId}/interactions?status=pending`,
      );
      setItems(all);
    } catch {
      /* ignore */
    }
  }, [planId]);

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
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
      {items.map((it) => (
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
              {it.kind === "approval" ? "Aprobación" : "Pregunta"} del refinamiento
            </span>
          </div>
          <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginBottom: 12 }}>
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
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  {it.options.map((o) => (
                    <button
                      key={o}
                      className="btn btn-sm"
                      disabled={busy === it.id}
                      onClick={() => answer(it.id, o)}
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
                  style={{ flex: 1 }}
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
