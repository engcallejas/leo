"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/client";
import type { PlanAttachment } from "@/lib/types";

export function PlanAttachments({
  planId,
  clickupOrigin,
}: {
  planId: number;
  clickupOrigin?: boolean;
}) {
  const [items, setItems] = useState<PlanAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const importFromClickup = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post(`/api/plans/${planId}/attachments/import`);
      setMsg(r.message || "Listo.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      setItems(await api.get(`/api/plans/${planId}/attachments`));
    } catch {
      /* ignore */
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f && f.size > 0);
      if (imgs.length === 0) return;
      setBusy(true);
      setErr(null);
      try {
        const fd = new FormData();
        imgs.forEach((f, i) => {
          // Pasted images often have no name — give them one.
          const name =
            f.name && f.name !== "image.png"
              ? f.name
              : `pegada-${Date.now()}-${i}.${(f.type.split("/")[1] || "png")}`;
          fd.append("file", f, name);
        });
        const res = await fetch(`/api/plans/${planId}/attachments`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        await load();
        if (inputRef.current) inputRef.current.value = "";
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [planId, load],
  );

  // Paste images anywhere on the plan page (Cmd/Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files: File[] = [];
      for (const item of e.clipboardData?.items ?? []) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        void uploadFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadFiles]);

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await api.del(`/api/plans/${planId}/attachments/${id}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: 14,
        marginBottom: 16,
        outline: dragOver ? "2px dashed var(--accent)" : "none",
        outlineOffset: -4,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length) void uploadFiles(files);
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: items.length ? 10 : 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          🖼️ Imágenes / adjuntos ({items.length})
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {clickupOrigin && (
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={importFromClickup}
              title="Descargar las imágenes adjuntas de la tarea de ClickUp"
            >
              ⬇ Importar de ClickUp
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
          />
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Subiendo…" : "+ Adjuntar"}
          </button>
        </div>
      </div>

      {err && (
        <div className="hint" style={{ color: "var(--danger)" }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="hint" style={{ color: "var(--ok)" }}>
          {msg}
        </div>
      )}
      {items.length === 0 ? (
        <div className="hint">
          <b>Pega (⌘V)</b>, arrastra o usa “Adjuntar” para subir mockups o
          capturas. Claude las lee (con la tool Read) durante el refinamiento y en
          cada paso.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {items.map((a) => {
              const isImg = a.mime.startsWith("image/");
              return (
                <div
                  key={a.id}
                  style={{
                    width: 110,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "var(--panel-2)",
                  }}
                >
                  <a
                    href={`/api/plans/${planId}/attachments/${a.id}/raw`}
                    target="_blank"
                    rel="noreferrer"
                    title={a.filename}
                  >
                    {isImg ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/plans/${planId}/attachments/${a.id}/raw`}
                        alt={a.filename}
                        style={{ width: "100%", height: 72, objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div style={{ height: 72, display: "grid", placeItems: "center", fontSize: 22 }}>
                        📎
                      </div>
                    )}
                  </a>
                  <div style={{ padding: "4px 6px" }}>
                    <div
                      className="muted"
                      style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {a.filename}
                    </div>
                    <button
                      className="btn btn-sm btn-danger"
                      style={{ width: "100%", marginTop: 3, padding: "1px 4px", fontSize: 10 }}
                      disabled={busy}
                      onClick={() => remove(a.id)}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Tip: <b>pega (⌘V)</b> o arrastra imágenes aquí para añadir más.
          </div>
        </>
      )}
    </div>
  );
}
