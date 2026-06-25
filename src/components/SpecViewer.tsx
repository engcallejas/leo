"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/client";
import { Markdown } from "@/components/Markdown";

interface SpecFile {
  path: string;
  abs: string;
  size: number;
}

export function SpecViewer({ projectId }: { projectId: number }) {
  const [files, setFiles] = useState<SpecFile[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<SpecFile | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || files) return;
    api
      .get(`/api/projects/${projectId}/specs`)
      .then((d: { files: SpecFile[] }) => setFiles(d.files))
      .catch(() => setFiles([]));
  }, [open, files, projectId]);

  const view = async (f: SpecFile) => {
    setActive(f);
    setLoading(true);
    setContent("");
    try {
      const d = await api.get(`/api/fs/read?path=${encodeURIComponent(f.abs)}`);
      setContent(d.content);
    } catch (e) {
      setContent(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((o) => !o)}
        style={{ border: "none", background: "transparent", padding: 0, fontWeight: 600 }}
      >
        {open ? "▾" : "▸"} 📄 Documentos de requerimientos
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {!files ? (
            <div className="muted" style={{ fontSize: 13 }}>Cargando…</div>
          ) : files.length === 0 ? (
            <div className="hint">
              Sin documentos. Configura globs de specs en el proyecto (ej.{" "}
              <code>specs/**/*.md</code>) para que aparezcan aquí.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 14 }}>
              <div style={{ display: "grid", gap: 4, alignContent: "start" }}>
                {files.map((f) => (
                  <button
                    key={f.abs}
                    className="btn btn-sm"
                    onClick={() => view(f)}
                    style={{
                      justifyContent: "flex-start",
                      textAlign: "left",
                      fontSize: 12,
                      background:
                        active?.abs === f.abs ? "var(--panel)" : "transparent",
                    }}
                    title={f.path}
                  >
                    {f.path}
                  </button>
                ))}
              </div>
              <div
                style={{
                  borderLeft: "1px solid var(--border)",
                  paddingLeft: 14,
                  minHeight: 120,
                  maxHeight: 460,
                  overflow: "auto",
                }}
              >
                {!active ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Elige un documento para leerlo.
                  </div>
                ) : loading ? (
                  <div className="muted" style={{ fontSize: 13 }}>Cargando…</div>
                ) : (
                  <Markdown text={content} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
