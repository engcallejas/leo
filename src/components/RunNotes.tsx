"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { timeAgo } from "@/components/format";
import { ImageAttach, imageFilesFromPaste } from "@/components/ImageAttach";
import type { RunNote } from "@/lib/types";

/**
 * Push steering instructions to a running agent. Notes are queued and the agent
 * pulls undelivered ones at its checkpoints (via the Leo MCP check_in tool), so
 * delivery is "at the next checkpoint", not instant.
 */
export function RunNotes({ runId, active }: { runId: number; active: boolean }) {
  const [notes, setNotes] = useState<RunNote[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
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
    if ((!t && images.length === 0) || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("text", t);
      for (const f of images) form.append("file", f);
      const note: RunNote = await api.postForm(`/api/runs/${runId}/notes`, form);
      setNotes((prev) => [...prev, note]);
      setText("");
      setImages([]);
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
        Envía correcciones sobre la marcha. Leo las inyecta automáticamente en
        cuanto el agente termina su siguiente herramienta, y le impide cerrar la
        tarea mientras haya notas sin entregar — así llegan en segundos/minutos,
        no al instante. Aplica a runs iniciados con esta versión.
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
              {n.text && (
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {n.text}
                </div>
              )}
              {n.images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: n.text ? 6 : 0 }}>
                  {n.images.map((im, i) => (
                    <span key={i} className="badge" style={{ fontSize: 10 }}>
                      🖼️ {im.filename}
                    </span>
                  ))}
                </div>
              )}
              <div
                className="muted"
                style={{ fontSize: 11, marginTop: 5, display: "flex", gap: 8 }}
              >
                <span>{timeAgo(n.created_at)}</span>
                <span
                  className={`badge badge-dot ${
                    n.delivered
                      ? "badge-ok"
                      : active
                        ? "badge-warn"
                        : "badge-danger"
                  }`}
                  style={{ fontSize: 10, padding: "1px 7px" }}
                >
                  {n.delivered
                    ? "entregada al agente"
                    : active
                      ? "pendiente de entrega"
                      : "no entregada (el run terminó)"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            className="textarea"
            placeholder="Ej. “No toques el archivo de migraciones”, “usa el patrón de OrderDetailPage”, “agrega también un test RTL”…"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const imgs = imageFilesFromPaste(e);
              if (imgs.length) {
                e.preventDefault();
                setImages((prev) => [...prev, ...imgs]);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            style={{ width: "100%", minHeight: 52, fontFamily: "inherit", fontSize: 13 }}
          />
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <ImageAttach files={images} onChange={setImages} disabled={busy} />
            <button
              className="btn btn-primary"
              onClick={send}
              disabled={busy || (!text.trim() && images.length === 0)}
              title="⌘/Ctrl + Enter"
            >
              {busy ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
