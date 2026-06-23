"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import { ErrorBar, Field } from "@/components/ui";
import { taskStatusLabel } from "@/components/format";
import type { Project, Task } from "@/lib/types";

type Mode = "task" | "manual";

export default function NewPlanPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mode, setMode] = useState<Mode>("task");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get("/api/projects")
      .then((p: Project[]) => {
        setProjects(p);
        if (p[0]) setProjectId(p[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api
      .get(`/api/tasks?project_id=${projectId}`)
      .then((t: Task[]) => {
        setTasks(t);
        setTaskId(t[0]?.id ?? null);
      })
      .catch(() => setTasks([]));
  }, [projectId]);

  const create = async () => {
    if (!projectId) return;
    setSaving(true);
    setErr(null);
    try {
      const body =
        mode === "task"
          ? { from_task_id: taskId }
          : { title: title.trim(), objective };
      if (mode === "task" && !taskId) throw new Error("Elige una tarea origen.");
      if (mode === "manual" && !title.trim())
        throw new Error("Escribe un título.");
      const plan = await api.post(`/api/projects/${projectId}/plans`, body);
      router.push(`/plans/${plan.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <Header
        title="Nueva planeación"
        subtitle="Elige un proyecto y el origen a refinar"
        right={
          <Link href="/plans" className="btn">
            ← Volver
          </Link>
        }
      />
      <div className="card" style={{ padding: 22, display: "grid", gap: 16 }}>
        <div>
          <label className="label">Proyecto</label>
          <select
            className="select"
            value={projectId ?? ""}
            onChange={(e) => setProjectId(Number(e.target.value))}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="hint">
            El refinamiento corre Claude (read-only) en el repo de este proyecto.
          </div>
        </div>

        <div>
          <label className="label">Origen</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={`btn btn-sm ${mode === "task" ? "btn-primary" : ""}`}
              onClick={() => setMode("task")}
            >
              Desde una tarea
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === "manual" ? "btn-primary" : ""}`}
              onClick={() => setMode("manual")}
            >
              Manual
            </button>
          </div>
        </div>

        {mode === "task" ? (
          <div>
            <label className="label">Tarea (ClickUp / Sentry / manual)</label>
            {tasks.length === 0 ? (
              <div className="hint">
                Este proyecto aún no tiene tareas. Usa “Poll ahora” o crea una
                tarea manual, o cambia a modo Manual.
              </div>
            ) : (
              <select
                className="select"
                value={taskId ?? ""}
                onChange={(e) => setTaskId(Number(e.target.value))}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.source_type}] {t.title.slice(0, 70)} —{" "}
                    {taskStatusLabel(t.status)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <>
            <Field
              label="Título"
              value={title}
              onChange={setTitle}
              placeholder="Ej. Migrar autenticación a Supabase Auth"
            />
            <div>
              <label className="label">Objetivo / requerimiento crudo</label>
              <textarea
                className="textarea"
                style={{ minHeight: 120 }}
                value={objective}
                placeholder="Describe en tus palabras qué se quiere lograr; Leo lo refinará."
                onChange={(e) => setObjective(e.target.value)}
              />
            </div>
          </>
        )}

        {err && <ErrorBar text={err} />}

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            borderTop: "1px solid var(--border)",
            paddingTop: 16,
          }}
        >
          <Link href="/plans" className="btn">
            Cancelar
          </Link>
          <button
            className="btn btn-primary"
            onClick={create}
            disabled={saving || !projectId}
          >
            {saving ? "Creando…" : "Crear plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
