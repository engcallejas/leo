"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  ProjectForm,
  draftToBody,
  emptyDraft,
  type Draft,
} from "@/components/ProjectForm";
import { ErrorBar } from "@/components/ui";
import type { Integration } from "@/lib/types";

export default function NewProjectPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/integrations").then(setIntegrations).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.post("/api/projects", draftToBody(draft));
      router.push("/projects");
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Header
        title="Nuevo proyecto"
        subtitle="Configura un repo local, su prompt y modo de ejecución"
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
            justifyContent: "flex-end",
            marginTop: 18,
            borderTop: "1px solid var(--border)",
            paddingTop: 16,
          }}
        >
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
  );
}
