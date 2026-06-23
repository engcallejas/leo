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
import type { Plan, Project } from "@/lib/types";

export default function PlansPage() {
  const router = useRouter();
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

  const projName = (id: number) =>
    projects.find((p) => p.id === id)?.name ?? `#${id}`;

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
