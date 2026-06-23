"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  fmtCost,
  fmtDuration,
  runStatusLabel,
  statusBadgeClass,
  timeAgo,
} from "@/components/format";
import type { Project, Run, Task } from "@/lib/types";

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const load = useCallback(async () => {
    const [r, p, t] = await Promise.all([
      api.get("/api/runs"),
      api.get("/api/projects"),
      api.get("/api/tasks"),
    ]);
    setRuns(r);
    setProjects(p);
    setTasks(t);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [load]);

  const projName = (id: number) =>
    projects.find((p) => p.id === id)?.name ?? `#${id}`;
  const taskTitle = (id: number) =>
    tasks.find((t) => t.id === id)?.title ?? `task #${id}`;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Header title="Ejecuciones" subtitle="Historial de runs de Claude Code" />

      {runs.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            Aún no hay ejecuciones. Usa “Poll ahora” o crea una tarea manual en un
            proyecto.
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Tarea</th>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Costo</th>
                <th>Turnos</th>
                <th>Duración</th>
                <th>Inicio</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/runs/${r.id}`)}
                >
                  <td className="mono muted">#{r.id}</td>
                  <td style={{ color: "var(--accent)" }}>
                    {taskTitle(r.task_id).slice(0, 60)}
                  </td>
                  <td className="muted">{projName(r.project_id)}</td>
                  <td>
                    <span className={statusBadgeClass(r.status)}>
                      {runStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtCost(r.cost_usd)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {r.num_turns ?? "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtDuration(r.duration_ms)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {timeAgo(r.started_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
