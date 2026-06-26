"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { ErrorBar, useConfirm } from "@/components/ui";
import type { Project } from "@/lib/types";

/**
 * The active account's projects (repos). Scoped server-side to the active
 * account. Deep edit/create live at /projects/[id] and /projects/new.
 */
export function AccountProjects() {
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await api.get("/api/projects"));
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [load]);

  const remove = async (id: number) => {
    if (
      !(await confirm({
        title: "Eliminar proyecto",
        body: "¿Eliminar este proyecto y sus tareas/runs?",
        confirmLabel: "Eliminar",
        danger: true,
      }))
    )
      return;
    await api.del(`/api/projects/${id}`);
    await load();
  };

  const nameOf = (id: number | null) =>
    id == null ? null : (items.find((p) => p.id === id)?.name ?? `#${id}`);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Repos de esta cuenta, cada uno con su prompt, branch y modo de
          ejecución.
        </p>
        <Link href="/projects/new" className="btn btn-primary">
          + Nuevo proyecto
        </Link>
      </div>

      {err && <ErrorBar text={err} />}

      {items.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            No hay proyectos en esta cuenta.{" "}
            <Link href="/projects/new" style={{ color: "var(--accent)" }}>
              Crea uno
            </Link>{" "}
            apuntando a la ruta local de un repo.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((p) => (
            <div key={p.id} className="card" style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>
                      {p.name}
                    </span>
                    {p.auto_mode ? (
                      <span className="badge badge-ok badge-dot">auto</span>
                    ) : (
                      <span className="badge badge-dot">manual</span>
                    )}
                    {!p.enabled && (
                      <span className="badge badge-warn">deshabilitado</span>
                    )}
                    <span className="badge">{p.permission_mode}</span>
                    {p.base_project_id != null && (
                      <span
                        className="badge"
                        title="Hereda configuración de otro proyecto"
                      >
                        ⤷ hereda de {nameOf(p.base_project_id)}
                      </span>
                    )}
                  </div>
                  <div className="muted mono" style={{ fontSize: 12, marginTop: 5 }}>
                    {p.repo_path}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {p.base_branch}
                    {p.target_branch ? ` → ${p.target_branch}` : ""} ·{" "}
                    {p.sources.length} fuente(s)
                    {p.model ? ` · ${p.model}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "start" }}>
                  <Link href={`/projects/${p.id}`} className="btn btn-sm">
                    Editar
                  </Link>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => remove(p.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog}
    </div>
  );
}
