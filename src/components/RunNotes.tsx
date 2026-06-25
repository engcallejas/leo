"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { timeAgo } from "@/components/format";
import type { RunNote } from "@/lib/types";

/**
 * Push steering instructions to a running agent. Notes are queued and the agent
 * pulls undelivered ones at its checkpoints (via the Leo MCP check_in tool), so
 * delivery is "at the next checkpoint", not instant.
 */
export function RunNotes({ runId, active }: { runId: number; active: boolean }) {
  const [notes, setNotes] = useState<RunNote[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await api.get(`/api/runs/${runId}/notes`));
    } catch {
      /* ignore */
    }
  }, [runId]);

  useEffect(() => {
    load();
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, active]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const note: RunNote = await api.post(`/api/runs/${runId}/notes`, { text: t });
      setNotes((prev) => [...prev, note]);
      setText("");
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show once finished and no history.
  if (!active && notes.length === 0) return null;

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        💬 Instrucciones para el agente
      </div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        Envía correcciones sobre la marcha. El agente las recoge en su próximo
        checkpoint (antes de commit/PR, entre pasos) y las incorpora — no es
        instantáneo. Requiere que el proyecto tenga activadas las preguntas de Claude.
      </div>

      {notes.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: active ? 12 : 0 }}>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                padding: "8px 11px",
                borderRadius: 8,
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {n.text}
              </div>
              <div
                className="muted"
                style={{ fontSize: 11, marginTop: 5, display: "flex", gap: 8 }}
              >
                <span>{timeAgo(n.created_at)}</span>
                <span
                  className={
                    n.delivered ? "badge badge-ok badge-dot" : "badge badge-warn badge-dot"
                  }
                  style={{ fontSize: 10, padding: "1px 7px" }}
                >
                  {n.delivered ? "entregada al agente" : "pendiente de entrega"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            className="textarea"
            placeholder="Ej. “No toques el archivo de migraciones”, “usa el patrón de OrderDetailPage”, “agrega también un test RTL”…"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            style={{ flex: 1, minHeight: 52, fontFamily: "inherit", fontSize: 13 }}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={busy || !text.trim()}
            title="⌘/Ctrl + Enter"
          >
            {busy ? "Enviando…" : "Enviar"}
          </button>
        </div>
      )}
    </div>
  );
}
