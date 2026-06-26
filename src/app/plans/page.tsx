"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  planStatusBadgeClass,
  planStatusLabel,
  timeAgo,
} from "@/components/format";
import { useConfirm } from "@/components/ui";
import type { Plan, Project } from "@/lib/types";

export default function PlansPage() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const load = useCallback(async () => {
    const [pl, pr] = await Promise.all([
      api.get("/api/plans"),
      api.get("/api/projects"),
    ]);
    setPlans(pl);
    setProjects(pr);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [load]);

  const [busyId, setBusyId] = useState<number | null>(null);

  const projName = (id: number) =>
    projects.find((p) => p.id === id)?.name ?? `#${id}`;

  const remove = async (p: Plan, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !(await confirm({
        title: "Eliminar plan",
        body: `¿Eliminar el plan #${p.id} “${p.title.slice(0, 60)}”? Si está refinando o ejecutando, se detiene primero. No se puede deshacer.`,
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    setBusyId(p.id);
    try {
      await api.del(`/api/plans/${p.id}`);
      setPlans((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      await load().catch(() => {});
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Header
        title="Planeación"
        subtitle="Refina un issue/tarea en un plan ejecutable y orquesta sus pasos"
        right={
          <Link href="/plans/new" className="btn btn-primary">
            + Nueva planeación
          </Link>
        }
      />

      {plans.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            Aún no hay planes. Crea uno desde una tarea de ClickUp, un issue de
            Sentry o de forma manual, y deja que Leo lo refine usando el contexto
            del proyecto.
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Plan</th>
                <th>Proyecto</th>
                <th>Origen</th>
                <th>Estado</th>
                <th>Actualizado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr
                  key={p.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/plans/${p.id}`)}
                >
                  <td className="mono muted">#{p.id}</td>
                  <td style={{ color: "var(--accent)", maxWidth: 380 }}>
                    {p.title.slice(0, 80)}
                  </td>
                  <td className="muted">{projName(p.project_id)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {p.source_type}
                  </td>
                  <td>
                    <span className={planStatusBadgeClass(p.status)}>
                      {planStatusLabel(p.status)}
                    </span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {timeAgo(p.updated_at)}
                  </td>
                  <td style={{ width: 36, textAlign: "right" }}>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => remove(p, e)}
                      disabled={busyId === p.id}
                      title="Eliminar plan (desde cualquier estado)"
                      style={{ padding: "3px 8px" }}
                    >
                      {busyId === p.id ? "…" : "✕"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </div>
  );
}
