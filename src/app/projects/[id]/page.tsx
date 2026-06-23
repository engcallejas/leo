"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  ProjectForm,
  draftToBody,
  projectToDraft,
  type Draft,
} from "@/components/ProjectForm";
import { ErrorBar } from "@/components/ui";
import type { Integration, Project } from "@/lib/types";

export default function EditProjectPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, ints] = await Promise.all([
          api.get(`/api/projects/${id}`),
          api.get("/api/integrations"),
        ]);
        setProject(p);
        setDraft(projectToDraft(p));
        setIntegrations(ints);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [id]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      await api.put(`/api/projects/${id}`, draftToBody(draft));
      router.push("/projects");
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("¿Eliminar este proyecto y sus tareas/runs?")) return;
    await api.del(`/api/projects/${id}`).catch(() => {});
    router.push("/projects");
  };

  if (!draft) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Header title="Editar proyecto" />
        {err ? <ErrorBar text={err} /> : <div className="muted">Cargando…</div>}
        <Link href="/projects" className="btn">
          ← Volver
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Header
        title={`Editar — ${project?.name ?? ""}`}
        subtitle="Cambia el repo, el prompt o el modo de ejecución"
        right={
          <Link href="/projects" className="btn">
            ← Volver
          </Link>
        }
      />
      <div className="card" style={{ padding: 22 }}>
        <ProjectForm draft={draft} setDraft={setDraft} integrations={integrations} />
        {err && (
          <div style={{ marginTop: 14 }}>
            <ErrorBar text={err} />
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "space-between",
            marginTop: 18,
            borderTop: "1px solid var(--border)",
            paddingTop: 16,
          }}
        >
          <button className="btn btn-danger" onClick={remove}>
            Eliminar
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/projects" className="btn">
              Cancelar
            </Link>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !draft.name || !draft.repo_path}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
