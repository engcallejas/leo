"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "@/components/client";

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

/** Tiny, safe markdown renderer (no dangerouslySetInnerHTML). */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let list: string[] | null = null;

  const flushList = () => {
    if (list) {
      out.push(
        <ul key={key++} style={{ margin: "6px 0", paddingLeft: 20 }}>
          {list.map((li, idx) => (
            <li key={idx} style={{ fontSize: 13, lineHeight: 1.6 }}>
              {inline(li)}
            </li>
          ))}
        </ul>,
      );
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre
          key={key++}
          className="mono"
          style={{
            background: "var(--panel-2)",
            padding: 10,
            borderRadius: 8,
            fontSize: 12,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const level = h[1].length;
      const size = level <= 1 ? 18 : level === 2 ? 16 : 14;
      out.push(
        <div
          key={key++}
          style={{ fontWeight: 700, fontSize: size, margin: "12px 0 4px" }}
        >
          {inline(h[2])}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      (list ??= []).push(line.replace(/^\s*[-*]\s+/, ""));
      i++;
      continue;
    }
    if (line.trim() === "") {
      flushList();
      i++;
      continue;
    }
    flushList();
    out.push(
      <p key={key++} style={{ fontSize: 13, lineHeight: 1.6, margin: "4px 0" }}>
        {inline(line)}
      </p>,
    );
    i++;
  }
  flushList();
  return <div>{out}</div>;
}

/** Inline parser: **bold**, `code`, [text](url). */
function inline(s: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push(<Fragment key={k++}>{s.slice(last, m.index)}</Fragment>);
    if (m[2]) tokens.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[4])
      tokens.push(
        <code key={k++} className="mono" style={{ fontSize: 12 }}>
          {m[4]}
        </code>,
      );
    else if (m[6])
      tokens.push(
        <a key={k++} href={m[7]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
          {m[6]}
        </a>,
      );
    last = re.lastIndex;
  }
  if (last < s.length) tokens.push(<Fragment key={k++}>{s.slice(last)}</Fragment>);
  return tokens;
}
