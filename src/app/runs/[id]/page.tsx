"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/client";
import { fmtCost, fmtDuration, runStatusLabel, timeAgo } from "@/components/format";
import { Markdown } from "@/components/Markdown";
import { RunInteractions } from "@/components/RunInteractions";
import { RunIterate } from "@/components/RunIterate";
import { RunNotes } from "@/components/RunNotes";
import {
  IconArrowLeft,
  IconDoc,
  IconLink,
  IconStop,
  IconTerminal,
} from "@/components/icons";
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
  const [tab, setTab] = useState<"resumen" | "transcript" | "task" | null>(null);
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
  }, [entries, tab]);

  const stop = async () => {
    await api.post(`/api/runs/${id}/stop`).catch(() => {});
    await loadMeta();
  };

  if (!run) {
    return (
      <div className="ed">
        <div style={{ maxWidth: 1040, margin: "0 auto" }}>
          <div className="muted" style={{ padding: 40 }}>
            Cargando run #{id}…
          </div>
        </div>
      </div>
    );
  }

  const running = run.status === "running";
  const hasResumen = !!run.error || !!run.result_summary;
  const hasTask = !!(task && (task.description || task.url));
  const defaultTab = running ? "transcript" : hasResumen ? "resumen" : "transcript";
  let activeTab = tab ?? defaultTab;
  if (activeTab === "resumen" && !hasResumen) activeTab = "transcript";
  if (activeTab === "task" && !hasTask) activeTab = "transcript";

  return (
    <div className="ed">
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        {/* ---- Header: back + actions ---- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <Link
          href="/runs"
          className="btn btn-sm"
          style={{ gap: 7, color: "var(--muted)" }}
        >
          <IconArrowLeft width={15} height={15} /> Ejecuciones
        </Link>
        {running && (
          <button className="btn btn-danger" onClick={stop} style={{ gap: 7 }}>
            <IconStop width={15} height={15} /> Detener run
          </button>
        )}
      </div>

      {/* ---- Run identity + metadata (no equal-box grid) ---- */}
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <RunStatusPill status={run.status} />
          <h1
            className="ed-display"
            style={{ margin: 0, fontSize: 31, fontWeight: 500, letterSpacing: "-0.015em" }}
          >
            Run #{run.id}
          </h1>
          {run.parent_run_id != null && (
            <Link
              href={`/runs/${run.parent_run_id}`}
              className="badge"
              style={{ fontSize: 11.5 }}
              title="Esta ejecución es una iteración de otra"
            >
              ↩ iteración de #{run.parent_run_id}
            </Link>
          )}
        </div>
        {task?.title && (
          <div
            style={{
              fontSize: 16,
              color: "var(--text)",
              marginTop: 9,
              fontWeight: 500,
              maxWidth: "70ch",
            }}
          >
            {task.title}
          </div>
        )}

        <div
          className="meta-strip"
          style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}
        >
          <Meta k="Costo" v={fmtCost(run.cost_usd)} />
          <Meta k="Turnos" v={run.num_turns ?? "—"} />
          <Meta k="Duración" v={fmtDuration(run.duration_ms)} />
          <Meta k="Inicio" v={timeAgo(run.started_at)} />
          {run.finished_at && <Meta k="Fin" v={timeAgo(run.finished_at)} />}
        </div>
      </header>

      {/* ---- Pending questions (urgent, above everything) ---- */}
      <RunInteractions runId={run.id} active={running} />

      {/* ---- Read surfaces as tabs (one panel, not a stack of cards) ---- */}
      <div className="tabbar">
        {hasResumen && (
          <button
            className={`tab${activeTab === "resumen" ? " active" : ""}`}
            onClick={() => setTab("resumen")}
          >
            <IconDoc width={15} height={15} />
            {run.error ? "Error" : "Resumen"}
          </button>
        )}
        <button
          className={`tab${activeTab === "transcript" ? " active" : ""}`}
          onClick={() => setTab("transcript")}
        >
          <IconTerminal width={15} height={15} />
          Transcripción
          {running && (
            <span className="live-dot" style={{ color: "var(--running)", marginLeft: 2 }} />
          )}
        </button>
        {hasTask && (
          <button
            className={`tab${activeTab === "task" ? " active" : ""}`}
            onClick={() => setTab("task")}
          >
            <IconLink width={15} height={15} />
            Tarea de origen
          </button>
        )}
        <span style={{ flex: 1 }} />
        {activeTab === "transcript" && (
          <label
            className="muted"
            style={{
              display: "flex",
              gap: 7,
              alignItems: "center",
              alignSelf: "center",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
            raw JSON
          </label>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        {/* Resumen / Error */}
        {activeTab === "resumen" &&
          (run.error ? (
            <div
              className="card"
              style={{
                padding: 18,
                borderColor: "color-mix(in srgb, var(--danger) 32%, var(--border))",
                background: "color-mix(in srgb, var(--danger) 7%, var(--panel))",
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--danger)",
                  marginBottom: 7,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                El run terminó con error
              </div>
              <div
                style={{ fontSize: 13.5, whiteSpace: "pre-wrap", color: "var(--text)" }}
              >
                {run.error}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "20px 22px" }}>
              <div className="md" style={{ fontSize: 13.5 }}>
                <Markdown text={run.result_summary ?? ""} />
              </div>
            </div>
          ))}

        {/* Transcripción (dark console) */}
        {activeTab === "transcript" && (
          <div
            ref={logBoxRef}
            className="term-body"
            style={{
              maxHeight: 580,
              overflow: "auto",
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid var(--border)",
            }}
          >
            {entries.length === 0 ? (
              <div style={{ padding: "8px 0", color: "#7d8794" }}>
                {running ? "Esperando salida del agente…" : "Sin salida registrada."}
              </div>
            ) : (
              entries.map((e, i) => (
                <div key={i} className="term-line" style={{ display: "flex", gap: 12 }}>
                  <span
                    style={{
                      color: kindColor(e.kind),
                      fontWeight: 600,
                      flex: "none",
                      width: 68,
                      textAlign: "right",
                      opacity: 0.85,
                      userSelect: "none",
                    }}
                  >
                    {raw ? e.kind : labelFor(e.kind)}
                  </span>
                  <span style={{ whiteSpace: "pre-wrap", minWidth: 0, flex: 1 }}>
                    {e.text}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tarea de origen */}
        {activeTab === "task" && task && (
          <div className="card" style={{ padding: "18px 20px" }}>
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--accent)",
                  fontSize: 13,
                  display: "inline-block",
                  marginBottom: 10,
                  fontWeight: 500,
                }}
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
                  margin: 0,
                  color: "var(--muted)",
                  lineHeight: 1.65,
                }}
              >
                {task.description}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ---- Act: iterate (finished) / steer (running) ---- */}
      <RunIterate run={run} />
      <RunNotes runId={run.id} active={running} />
      </div>
    </div>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "badge-ok"
      : status === "failed" || status === "cancelled"
        ? "badge-danger"
        : status === "running"
          ? "badge-running"
          : "";
  const running = status === "running";
  return (
    <span
      className={`badge ${tone}`}
      style={{ fontSize: 12.5, padding: "5px 12px", gap: 7, fontWeight: 600 }}
    >
      {running ? (
        <span className="live-dot" />
      ) : (
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: "currentColor",
            display: "inline-block",
          }}
        />
      )}
      {runStatusLabel(status)}
    </span>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="meta-item">
      <span className="meta-k">{k}</span>
      <span className="meta-v">{v}</span>
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
