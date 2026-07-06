"use client";

import { useEffect, useRef, useState } from "react";

interface Entry {
  kind: string;
  text: string;
}

export function RefineProgress({
  planId,
  refining,
}: {
  planId: number;
  refining: boolean;
}) {
  const [open, setOpen] = useState(refining);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [done, setDone] = useState(false);
  const bufRef = useRef("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Auto-open while refining.
  useEffect(() => {
    if (refining) setOpen(true);
  }, [refining]);

  // Connect the SSE when open.
  useEffect(() => {
    if (!open) return;
    setEntries([]);
    setDone(false);
    bufRef.current = "";
    const es = new EventSource(`/api/plans/${planId}/refine-logs`);
    const onChunk = (e: MessageEvent) => {
      const { text } = JSON.parse(e.data);
      bufRef.current += text;
      const lines = bufRef.current.split("\n");
      bufRef.current = lines.pop() ?? "";
      const fresh = lines
        .filter((l) => l.trim())
        .map(formatRefineLine)
        .filter(Boolean) as Entry[];
      if (fresh.length) setEntries((p) => [...p, ...fresh]);
    };
    const finish = () => {
      es.close();
      setDone(true);
    };
    es.addEventListener("chunk", onChunk as EventListener);
    es.addEventListener("done", finish);
    es.onerror = finish;
    return () => es.close();
  }, [open, planId]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div
      className="card"
      style={{
        padding: 14,
        marginBottom: 16,
        ...(refining
          ? { border: "1px solid var(--running, #5b6cff)" }
          : {}),
      }}
    >
      <button
        className="btn btn-sm"
        onClick={() => setOpen((o) => !o)}
        style={{ border: "none", background: "transparent", padding: 0, fontWeight: 600 }}
      >
        {open ? "▾" : "▸"} 🔎 Análisis del refinamiento{" "}
        {refining && (
          <span className="badge badge-running badge-dot" style={{ marginLeft: 6 }}>
            en vivo
          </span>
        )}
      </button>

      {open && (
        <div
          ref={boxRef}
          style={{
            marginTop: 10,
            maxHeight: 320,
            overflow: "auto",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {entries.length === 0 ? (
            <div className="muted">
              {refining
                ? "Claude está leyendo el repositorio…"
                : done
                  ? "Sin análisis registrado."
                  : "Cargando…"}
            </div>
          ) : (
            entries.map((e, i) => (
              <div key={i} style={{ marginBottom: 5 }}>
                <span
                  style={{ color: colorFor(e.kind), fontWeight: 600, marginRight: 8 }}
                >
                  {labelFor(e.kind)}
                </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{e.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function colorFor(kind: string): string {
  if (kind === "assistant") return "var(--accent)";
  if (kind === "ask") return "var(--warn, #b58900)";
  if (kind === "tool") return "var(--warn)";
  if (kind === "result") return "var(--ok)";
  if (kind === "error") return "var(--danger)";
  return "var(--muted)";
}
function labelFor(kind: string): string {
  return (
    {
      assistant: "claude",
      ask: "pregunta",
      tool: "lee",
      result: "✓",
      start: "▶",
      error: "error",
      system: "·",
    }[kind] ?? kind
  );
}

function formatRefineLine(line: string): Entry | null {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  const type = e.type as string;
  if (type === "leo_refine_start") {
    const fb = String(e.feedback ?? "").trim();
    return fb
      ? { kind: "ask", text: `iterando con tus comentarios: ${fb.slice(0, 200)}` }
      : { kind: "start", text: "iniciando análisis del repo…" };
  }
  if (type === "leo_refine_done") return { kind: "result", text: `plan generado (${e.steps ?? "?"} pasos)` };
  if (type === "leo_refine_error" || type === "leo_error")
    return { kind: "error", text: String(e.message ?? "error en el refinamiento") };
  if (type === "assistant") {
    const msg = e.message as { content?: unknown[] } | undefined;
    const parts: string[] = [];
    for (const b of msg?.content ?? []) {
      const bl = b as Record<string, unknown>;
      if (bl.type === "text" && String(bl.text).trim()) parts.push(String(bl.text).trim());
      else if (bl.type === "tool_use") {
        const inp = bl.input as Record<string, unknown> | undefined;
        const name = String(bl.name ?? "");
        // A question to the human stands out from plain file reads.
        if (name.includes("ask_user") || name.includes("request_approval")) {
          const q = String(inp?.question ?? inp?.action ?? "").trim();
          return { kind: "ask", text: `🙋 te pregunta: ${q.slice(0, 200)}` };
        }
        const target =
          (inp?.file_path as string) ||
          (inp?.pattern as string) ||
          (inp?.path as string) ||
          (inp?.command as string) ||
          "";
        return { kind: "tool", text: `${bl.name}${target ? ` ${String(target).slice(0, 80)}` : ""}` };
      }
    }
    const text = parts.join("\n");
    return text ? { kind: "assistant", text: text.slice(0, 400) } : null;
  }
  if (type === "result") {
    return { kind: "result", text: "análisis completo, sintetizando plan…" };
  }
  return null;
}
