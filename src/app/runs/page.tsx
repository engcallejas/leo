"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/client";
import {
  DATE_PRESETS,
  FilterBar,
  FilterSelect,
  presetDays,
  withinDate,
} from "@/components/filters";
import {
  fmtCost,
  fmtDuration,
  runStatusLabel,
  statusBadgeClass,
  timeAgo,
} from "@/components/format";
import type { Project, Run, Task } from "@/lib/types";

/**
 * Flatten runs into a lineage forest: iterations nest under the run they came
 * from (runs.parent_run_id). Groups with the most recent activity float to top;
 * within a group, iterations are listed in chronological order.
 */
function buildRunForest(runs: Run[]): { run: Run; depth: number }[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const children = new Map<number, Run[]>();
  const roots: Run[] = [];
  for (const r of runs) {
    if (r.parent_run_id != null && byId.has(r.parent_run_id)) {
      const arr = children.get(r.parent_run_id) ?? [];
      arr.push(r);
      children.set(r.parent_run_id, arr);
    } else {
      roots.push(r);
    }
  }
  const maxIdMemo = new Map<number, number>();
  const maxId = (r: Run): number => {
    const cached = maxIdMemo.get(r.id);
    if (cached != null) return cached;
    let m = r.id;
    for (const c of children.get(r.id) ?? []) m = Math.max(m, maxId(c));
    maxIdMemo.set(r.id, m);
    return m;
  };
  roots.sort((a, b) => maxId(b) - maxId(a));
  const out: { run: Run; depth: number }[] = [];
  const walk = (r: Run, depth: number) => {
    out.push({ run: r, depth });
    for (const c of (children.get(r.id) ?? []).slice().sort((a, b) => a.id - b.id))
      walk(c, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return out;
}

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dateF, setDateF] = useState("all");

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

  const visible = useMemo(() => {
    const days = presetDays(dateF);
    return runs.filter((r) => withinDate(r.started_at, days));
  }, [runs, dateF]);
  const forest = useMemo(() => buildRunForest(visible), [visible]);

  return (
    <div className="ed">
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1
          className="ed-display"
          style={{ margin: 0, fontSize: 30, fontWeight: 500, letterSpacing: "-0.015em" }}
        >
          Ejecuciones
        </h1>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Historial de runs de Claude Code
        </div>
      </div>

      {runs.length > 0 && (
        <FilterBar right={`${forest.length} de ${runs.length}`}>
          <FilterSelect
            label="Fecha"
            value={dateF}
            onChange={setDateF}
            options={DATE_PRESETS.map((d) => ({ value: d.key, label: d.label }))}
          />
        </FilterBar>
      )}

      {runs.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            Aún no hay ejecuciones. Usa “Poll ahora” o crea una tarea manual en un
            proyecto.
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            Ninguna ejecución en el rango de fecha seleccionado.
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
              {forest.map(({ run: r, depth }) => (
                <tr
                  key={r.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/runs/${r.id}`)}
                >
                  <td className="mono muted">#{r.id}</td>
                  <td style={{ color: "var(--accent)" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        paddingLeft: depth * 20,
                      }}
                    >
                      {depth > 0 && (
                        <span
                          className="tree-rail"
                          title={`Iteración de #${r.parent_run_id}`}
                          style={{ fontSize: 13 }}
                        >
                          └─
                        </span>
                      )}
                      <span>{taskTitle(r.task_id).slice(0, 60)}</span>
                      {r.parent_run_id != null && (
                        <span
                          className="badge"
                          style={{ fontSize: 10, fontWeight: 500 }}
                        >
                          ↩ #{r.parent_run_id}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="muted">{projName(r.project_id)}</td>
                  <td>
                    {r.status === "running" ? (
                      <span
                        className="badge badge-running"
                        style={{ gap: 6, fontWeight: 600 }}
                      >
                        <span className="live-dot" />
                        {runStatusLabel(r.status)}
                      </span>
                    ) : (
                      <span className={statusBadgeClass(r.status)}>
                        {runStatusLabel(r.status)}
                      </span>
                    )}
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
    </div>
  );
}
