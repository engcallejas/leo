"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  fmtCost,
  runStatusLabel,
  statusBadgeClass,
  taskStatusLabel,
  timeAgo,
} from "@/components/format";
import { useConfirm } from "@/components/ui";
import type { AppSettings, Project, Run, Task } from "@/lib/types";

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [polling, setPolling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, r, t, s] = await Promise.all([
      api.get("/api/projects"),
      api.get("/api/runs"),
      api.get("/api/tasks"),
      api.get("/api/settings"),
    ]);
    setProjects(p);
    setRuns(r);
    setTasks(t);
    setSettings(s);
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [load]);

  const projName = (id: number) =>
    projects.find((p) => p.id === id)?.name ?? `#${id}`;

  // The execution queue only shows tasks meant to run: development/both sources
  // and manual tasks. Planning-only tasks live in the plan picker, not here.
  const pending = tasks.filter(
    (t) =>
      (t.status === "pending" || t.status === "queued") &&
      t.source_role !== "planning" &&
      !t.parent_task_id, // chain subtasks are managed by their parent
  );

  const pollNow = async () => {
    setPolling(true);
    setMsg(null);
    try {
      const res = await api.post("/api/poll");
      setMsg(
        `Poll completado · ${res.sourcesPolled} fuentes · ${res.started} iniciadas · ${res.pending} pendientes`,
      );
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setPolling(false);
    }
  };

  const toggleAutoRun = async () => {
    if (!settings) return;
    const next = !settings.auto_run_enabled;
    setSettings({ ...settings, auto_run_enabled: next });
    await api.put("/api/settings", { auto_run_enabled: next }).catch(() => {});
  };

  const stats = [
    { label: "Proyectos", value: projects.length, href: "/account" },
    {
      label: "Integraciones",
      value: new Set(
        projects.flatMap((p) => p.sources.map((s) => s.integration_id)),
      ).size,
      href: "/account",
    },
    { label: "Tareas pendientes", value: pending.length, href: "/runs" },
    {
      label: "Runs activos",
      value: runs.filter((r) => r.status === "running").length,
      href: "/runs",
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Header
        title="Dashboard"
        subtitle="Estado del orquestador en tiempo real"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="btn"
              onClick={toggleAutoRun}
              title="Interruptor global: si está apagado, el scheduler nunca ejecuta solo."
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: settings?.auto_run_enabled
                    ? "var(--ok)"
                    : "var(--muted)",
                }}
              />
              Auto-run {settings?.auto_run_enabled ? "ON" : "OFF"}
            </button>
            <button
              className="btn btn-primary"
              onClick={pollNow}
              disabled={polling}
            >
              {polling ? "Consultando…" : "Poll ahora"}
            </button>
          </div>
        }
      />

      {msg && (
        <div className="card" style={{ padding: "10px 14px", marginBottom: 16 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {msg}
          </span>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 22,
        }}
      >
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="card"
            style={{ padding: 16 }}
          >
            <div className="muted" style={{ fontSize: 12 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 4 }}>
              {s.value}
            </div>
          </Link>
        ))}
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 18 }}
      >
        <section className="card" style={{ overflow: "hidden" }}>
          <SectionTitle title="Ejecuciones recientes" href="/runs" />
          {runs.length === 0 ? (
            <Empty text="Sin ejecuciones todavía." />
          ) : (
            <table className="tbl">
              <tbody>
                {runs.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td style={{ width: 40 }}>
                      <Link href={`/runs/${r.id}`} className="mono muted">
                        #{r.id}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/runs/${r.id}`}>
                        {projName(r.project_id)}
                      </Link>
                    </td>
                    <td>
                      <span className={statusBadgeClass(r.status)}>
                        {runStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {fmtCost(r.cost_usd)}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {timeAgo(r.started_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card" style={{ overflow: "hidden" }}>
          <SectionTitle title="Cola de tareas" />
          {pending.length === 0 ? (
            <Empty text="No hay tareas pendientes." />
          ) : (
            <div style={{ padding: 6 }}>
              {pending.slice(0, 12).map((t) => (
                <QueueItem
                  key={t.id}
                  task={t}
                  projectName={projName(t.project_id)}
                  onChanged={async (m) => {
                    if (m) setMsg(m);
                    await load();
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ title, href }: { title: string; href?: string }) {
  return (
    <div
      style={{
        padding: "13px 14px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      {href && (
        <Link href={href} className="muted" style={{ fontSize: 12 }}>
          ver todo →
        </Link>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      className="muted"
      style={{ padding: 24, textAlign: "center", fontSize: 13 }}
    >
      {text}
    </div>
  );
}

function QueueItem({
  task,
  projectName,
  onChanged,
}: {
  task: Task;
  projectName: string;
  onChanged: (msg?: string) => void;
}) {
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/tasks/${task.id}/run`);
      onChanged(r.started ? "Run iniciado" : r.queued ? "En cola" : r.reason);
    } catch (e) {
      onChanged((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const queue = async () => {
    setBusy(true);
    try {
      await api.post(`/api/tasks/${task.id}/queue`, {});
      onChanged("Encolada");
    } catch (e) {
      onChanged((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const schedule = async () => {
    if (!when) return;
    setBusy(true);
    try {
      await api.post(`/api/tasks/${task.id}/queue`, {
        scheduled_for: new Date(when).toISOString(),
      });
      onChanged("Programada");
      setWhen("");
    } catch (e) {
      onChanged((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (
      !(await confirm({
        title: "Descartar tarea",
        body: `¿Descartar "${task.title}"? No se ejecutará ni se volverá a traer.`,
        confirmLabel: "Descartar",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api.post(`/api/tasks/${task.id}/skip`);
      onChanged("Descartada");
    } catch (e) {
      onChanged((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "9px 10px", borderBottom: "1px solid var(--border)" }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.title}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {projectName} ·{" "}
            <span className={statusBadgeClass(task.status)}>
              {taskStatusLabel(task.status)}
            </span>
            {task.scheduled_for && (
              <> · 🕒 {new Date(task.scheduled_for).toLocaleString()}</>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={run} disabled={busy}>
            Ejecutar
          </button>
          <button className="btn btn-sm" onClick={queue} disabled={busy}>
            Encolar
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={discard}
            disabled={busy}
            title="Descartar: no se ejecuta ni se vuelve a traer"
          >
            ✕
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        <input
          type="datetime-local"
          className="input"
          style={{ maxWidth: 210, padding: "4px 8px", fontSize: 12 }}
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <button
          className="btn btn-sm"
          onClick={schedule}
          disabled={busy || !when}
        >
          Programar
        </button>
      </div>
      {dialog}
    </div>
  );
}
