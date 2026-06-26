"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import { ErrorBar, Field, Modal, useConfirm } from "@/components/ui";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<Project | null>(null);

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

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <Header
        title="Proyectos"
        subtitle="Cada repo local con su prompt, branch destino y modo de ejecución"
        right={
          <Link href="/projects/new" className="btn btn-primary">
            + Nuevo proyecto
          </Link>
        }
      />

      {err && <ErrorBar text={err} />}

      {items.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <div className="muted">
            No hay proyectos.{" "}
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
                  </div>
                  <div
                    className="muted mono"
                    style={{ fontSize: 12, marginTop: 5 }}
                  >
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
                  <button
                    className="btn btn-sm"
                    onClick={() => setManualFor(p)}
                  >
                    + Tarea
                  </button>
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

      {manualFor && (
        <ManualTaskModal
          project={manualFor}
          onClose={() => setManualFor(null)}
        />
      )}
      {dialog}
    </div>
  );
}

function ManualTaskModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (runNow: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const task = await api.post("/api/tasks", {
        project_id: project.id,
        title,
        description,
      });
      if (runNow) await api.post(`/api/tasks/${task.id}/run`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Tarea manual — ${project.name}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 14 }}>
        <Field
          label="Título"
          value={title}
          onChange={setTitle}
          placeholder="Qué hay que hacer"
        />
        <div>
          <label className="label">Descripción</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalle, contexto, criterios de aceptación…"
          />
        </div>
        {err && <ErrorBar text={err} />}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn"
            onClick={() => create(false)}
            disabled={!title || busy}
          >
            Crear
          </button>
          <button
            className="btn btn-primary"
            onClick={() => create(true)}
            disabled={!title || busy}
          >
            Crear y ejecutar
          </button>
        </div>
      </div>
    </Modal>
  );
}
