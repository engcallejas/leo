"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  fmtCost,
  fmtDuration,
  runStatusLabel,
  statusBadgeClass,
  timeAgo,
} from "@/components/format";
import { RunInteractions } from "@/components/RunInteractions";
import { RunIterate } from "@/components/RunIterate";
import { RunNotes } from "@/components/RunNotes";
import type { Run, Task } from "@/lib/types";

interface LogEntry {
  kind: string;
  text: string;
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [run, setRun] = useState<Run | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [raw, setRaw] = useState(false);
  const bufferRef = useRef("");
  const logBoxRef = useRef<HTMLDivElement>(null);

  const loadMeta = useCallback(async () => {
    const data = await api.get(`/api/runs/${id}`);
    setRun(data.run);
    setTask(data.task);
  }, [id]);

  useEffect(() => {
    loadMeta().catch(() => {});
  }, [loadMeta]);

  // Live log stream.
  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const es = new EventSource(`/api/runs/${id}/logs`);
    const onChunk = (e: MessageEvent) => {
      const { text } = JSON.parse(e.data);
      bufferRef.current += text;
      const lines = bufferRef.current.split("\n");
      bufferRef.current = lines.pop() ?? "";
      const newEntries = lines
        .filter((l) => l.trim())
        .map(formatLine)
        .filter(Boolean) as LogEntry[];
      if (newEntries.length) setEntries((prev) => [...prev, ...newEntries]);
    };
    const onDone = () => {
      es.close();
      loadMeta().catch(() => {});
    };
    es.addEventListener("chunk", onChunk as EventListener);
    es.addEventListener("done", onDone);
    es.onerror = () => {
      es.close();
      loadMeta().catch(() => {});
    };
    return () => es.close();
  }, [id, loadMeta]);

  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const stop = async () => {
    await api.post(`/api/runs/${id}/stop`).catch(() => {});
    await loadMeta();
  };

  if (!run) {
    return (
      <div>
        <Header title={`Run #${id}`} />
        <div className="muted">Cargando…</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <Header
        title={`Run #${run.id}`}
        subtitle={task?.title}
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/runs" className="btn">
              ← Volver
            </Link>
            {run.status === "running" && (
              <button className="btn btn-danger" onClick={stop}>
                Detener
              </button>
            )}
          </div>
        }
      />

      {run.parent_run_id && (
        <div style={{ marginBottom: 12, fontSize: 12.5 }}>
          <Link
            href={`/runs/${run.parent_run_id}`}
            className="muted"
            style={{ textDecoration: "none" }}
          >
            ↩ Iteración de run #{run.parent_run_id}
          </Link>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Stat
          label="Estado"
          value={
            <span className={statusBadgeClass(run.status)}>
              {runStatusLabel(run.status)}
            </span>
          }
        />
        <Stat label="Costo" value={fmtCost(run.cost_usd)} />
        <Stat label="Turnos" value={run.num_turns ?? "—"} />
        <Stat label="Duración" value={fmtDuration(run.duration_ms)} />
        <Stat label="Inicio" value={timeAgo(run.started_at)} />
      </div>

      {task && (task.description || task.url) && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", fontSize: 13 }}
            >
              {task.url} ↗
            </a>
          )}
          {task.description && (
            <pre
              className="mono"
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 12,
                margin: "8px 0 0",
                color: "var(--muted)",
              }}
            >
              {task.description}
            </pre>
          )}
        </div>
      )}

      <RunInteractions runId={run.id} active={run.status === "running"} />

      <RunNotes runId={run.id} active={run.status === "running"} />

      <RunIterate run={run} />

      {run.error && (
        <div
          className="card badge-danger"
          style={{ padding: "10px 14px", marginBottom: 16, fontSize: 13 }}
        >
          {run.error}
        </div>
      )}

      <div
        className="card"
        style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            Transcripción{" "}
            {run.status === "running" && (
              <span className="badge badge-running badge-dot">en vivo</span>
            )}
          </span>
          <label
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 12,
            }}
            className="muted"
          >
            <input
              type="checkbox"
              checked={raw}
              onChange={(e) => setRaw(e.target.checked)}
            />
            raw JSON
          </label>
        </div>
        <div
          ref={logBoxRef}
          style={{
            maxHeight: 540,
            overflow: "auto",
            padding: "10px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          {entries.length === 0 ? (
            <div className="muted">Esperando salida…</div>
          ) : (
            entries.map((e, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <span
                  style={{
                    color: kindColor(e.kind),
                    fontWeight: 600,
                    marginRight: 8,
                  }}
                >
                  {raw ? e.kind : labelFor(e.kind)}
                </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{e.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {run.result_summary && (
        <div className="card" style={{ padding: 14, marginTop: 16 }}>
          <div className="label">Resumen final</div>
          <pre
            className="mono"
            style={{ whiteSpace: "pre-wrap", fontSize: 12.5, margin: 0 }}
          >
            {run.result_summary}
          </pre>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="muted" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function kindColor(kind: string): string {
  if (kind === "assistant") return "var(--accent)";
  if (kind === "tool") return "var(--warn)";
  if (kind === "result") return "var(--ok)";
  if (kind === "error" || kind === "stderr") return "var(--danger)";
  if (kind === "start" || kind === "system") return "var(--running)";
  return "var(--muted)";
}

function labelFor(kind: string): string {
  const map: Record<string, string> = {
    assistant: "claude",
    tool: "tool",
    tool_result: "result",
    result: "✓ final",
    error: "error",
    stderr: "stderr",
    start: "▶ start",
    system: "system",
    user: "user",
  };
  return map[kind] ?? kind;
}

// Convert one JSONL line into a readable entry.
function formatLine(line: string): LogEntry | null {
  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(line);
  } catch {
    return { kind: "raw", text: line };
  }
  const type = evt.type as string;

  if (type === "leo_start") {
    return {
      kind: "start",
      text: `claude en ${evt.cwd} · permisos: ${evt.permission_mode}`,
    };
  }
  if (type === "leo_end") {
    return { kind: "system", text: `proceso terminó (exit ${evt.exit_code})` };
  }
  if (type === "leo_error") {
    return { kind: "error", text: String(evt.message) };
  }
  if (type === "leo_stderr") {
    return { kind: "stderr", text: String(evt.text).trim() };
  }
  if (type === "leo_resolve") {
    return {
      kind: evt.ok ? "result" : "error",
      text: `${evt.ok ? "✓" : "✕"} Sentry: ${String(evt.message)}`,
    };
  }
  if (type === "system") {
    if (evt.subtype === "init")
      return { kind: "system", text: `sesión iniciada (${evt.model ?? ""})` };
    return { kind: "system", text: String(evt.subtype ?? "system") };
  }
  if (type === "assistant") {
    const msg = evt.message as { content?: unknown[] } | undefined;
    const parts: string[] = [];
    for (const block of msg?.content ?? []) {
      const b = block as Record<string, unknown>;
      if (b.type === "text") parts.push(String(b.text));
      else if (b.type === "tool_use")
        return {
          kind: "tool",
          text: `${b.name}(${shortJson(b.input)})`,
        };
    }
    const text = parts.join("\n").trim();
    return text ? { kind: "assistant", text } : null;
  }
  if (type === "user") {
    const msg = evt.message as { content?: unknown[] } | undefined;
    for (const block of msg?.content ?? []) {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_result") {
        return { kind: "tool_result", text: shortText(b.content) };
      }
    }
    return null;
  }
  if (type === "result") {
    const summary = (evt.result as string) || (evt.subtype as string) || "done";
    return { kind: "result", text: shortText(summary) };
  }
  return { kind: "raw", text: line.slice(0, 300) };
}

function shortJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return "";
  }
}
function shortText(v: unknown): string {
  let s: string;
  if (typeof v === "string") s = v;
  else if (Array.isArray(v))
    s = v
      .map((x) =>
        typeof x === "string"
          ? x
          : (x as { text?: string })?.text ?? JSON.stringify(x),
      )
      .join("\n");
  else s = JSON.stringify(v);
  return s.length > 600 ? s.slice(0, 600) + "…" : s;
}
