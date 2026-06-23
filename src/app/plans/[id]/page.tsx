"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import {
  planStatusBadgeClass,
  planStatusLabel,
  planStepStatusLabel,
  timeAgo,
} from "@/components/format";
import { ErrorBar } from "@/components/ui";
import type { PlanStep, PlanWithSteps } from "@/lib/types";

const LIVE = new Set(["refining", "queued", "running"]);

export default function PlanDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [plan, setPlan] = useState<PlanWithSteps | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const dirty = useRef(false);

  const load = useCallback(async () => {
    const p = await api.get(`/api/plans/${id}`);
    setPlan(p);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  // Live-poll while the plan is refining / queued / running, unless the user is
  // mid-edit (don't clobber their text).
  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current) return;
      if (plan && !LIVE.has(plan.status)) return;
      load().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [plan, load]);

  if (!plan) {
    return (
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <Header title="Plan" />
        {err ? <ErrorBar text={err} /> : <div className="muted">Cargando…</div>}
        <Link href="/plans" className="btn">
          ← Volver
        </Link>
      </div>
    );
  }

  const active = plan.status === "running" || plan.status === "queued";
  const refining = plan.status === "refining";
  const locked = active || refining;

  const patch = (p: Partial<PlanWithSteps>) => {
    dirty.current = true;
    setPlan({ ...plan, ...p });
  };
  const patchStep = (sid: number, sp: Partial<PlanStep>) => {
    dirty.current = true;
    setPlan({
      ...plan,
      steps: plan.steps.map((s) => (s.id === sid ? { ...s, ...sp } : s)),
    });
  };

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act("save", async () => {
      const updated = await api.put(`/api/plans/${id}`, {
        title: plan.title,
        objective: plan.objective,
        refined_spec: plan.refined_spec,
        steps: plan.steps.map((s) => ({ title: s.title, spec: s.spec })),
      });
      dirty.current = false;
      setPlan(updated);
      setMsg("Guardado.");
    });

  const refine = () =>
    act("refine", async () => {
      // Persist any pending edits to objective/title first so refinement uses them.
      if (dirty.current) {
        await api.put(`/api/plans/${id}`, {
          title: plan.title,
          objective: plan.objective,
        });
        dirty.current = false;
      }
      const p = await api.post(`/api/plans/${id}/refine`);
      setPlan(p.steps ? p : { ...plan, ...p, steps: plan.steps });
      setMsg("Refinamiento iniciado. Claude está analizando el repo…");
    });

  const addStep = () =>
    act("addStep", async () => {
      const s = await api.post(`/api/plans/${id}/steps`, {
        title: "Nuevo paso",
        spec: "",
      });
      setPlan({ ...plan, steps: [...plan.steps, s] });
    });

  const removeStep = (sid: number) =>
    act("rm" + sid, async () => {
      await api.del(`/api/plans/${id}/steps/${sid}`);
      setPlan({ ...plan, steps: plan.steps.filter((s) => s.id !== sid) });
    });

  const pushClickup = () =>
    act("clickup", async () => {
      const r = await api.post(`/api/plans/${id}/push-clickup`);
      if (r.plan) setPlan(r.plan);
      setMsg(r.message || "Listo.");
    });

  const enqueue = (scheduledFor: string | null) =>
    act("enqueue", async () => {
      if (dirty.current) await save();
      const p = await api.post(`/api/plans/${id}/enqueue`, {
        scheduled_for: scheduledFor,
      });
      setPlan(p);
      setMsg(
        scheduledFor
          ? "Programado. Se ejecutará a la hora indicada."
          : "Encolado. Los pasos se ejecutarán en orden.",
      );
    });

  const cancel = () =>
    act("cancel", async () => {
      const p = await api.post(`/api/plans/${id}/cancel`);
      setPlan(p);
    });

  const remove = async () => {
    if (!confirm("¿Eliminar este plan y sus pasos?")) return;
    await api.del(`/api/plans/${id}`).catch(() => {});
    router.push("/plans");
  };

  const doneCount = plan.steps.filter((s) => s.status === "done").length;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <Header
        title={plan.title}
        subtitle={`Plan #${plan.id} · origen ${plan.source_type}${
          plan.steps.length ? ` · ${doneCount}/${plan.steps.length} pasos` : ""
        }`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={planStatusBadgeClass(plan.status)}>
              {planStatusLabel(plan.status)}
            </span>
            <Link href="/plans" className="btn">
              ← Volver
            </Link>
          </div>
        }
      />

      {err && <ErrorBar text={err} />}
      {msg && (
        <div
          className="card"
          style={{
            padding: "9px 12px",
            marginBottom: 14,
            fontSize: 13,
            borderColor: "var(--ok)",
          }}
        >
          {msg}
        </div>
      )}
      {plan.error && plan.status === "failed" && <ErrorBar text={plan.error} />}

      {/* Actions */}
      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
        }}
      >
        <button
          className="btn btn-primary"
          onClick={refine}
          disabled={!!busy || locked}
          title="Claude analiza el repo (read-only) y propone spec + pasos"
        >
          {refining
            ? "Refinando…"
            : busy === "refine"
              ? "Iniciando…"
              : plan.steps.length
                ? "Re-refinar"
                : "✦ Refinar"}
        </button>
        <button className="btn" onClick={save} disabled={!!busy || locked}>
          {busy === "save" ? "Guardando…" : "Guardar"}
        </button>
        <button
          className="btn"
          onClick={pushClickup}
          disabled={!!busy || !plan.steps.length || locked}
          title="Crea subtasks en ClickUp bajo la tarea padre"
        >
          {busy === "clickup" ? "Enviando…" : "⇪ Crear subtasks ClickUp"}
        </button>
        <div style={{ flex: 1 }} />
        {active ? (
          <button className="btn btn-danger" onClick={cancel} disabled={!!busy}>
            Cancelar ejecución
          </button>
        ) : (
          <>
            <input
              type="datetime-local"
              className="input"
              style={{ width: 200 }}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <button
              className="btn"
              onClick={() =>
                enqueue(when ? new Date(when).toISOString() : null)
              }
              disabled={!!busy || !plan.steps.length}
              title="Programa la orquestación para más tarde"
            >
              {when ? "Programar" : "Programar"}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => enqueue(null)}
              disabled={!!busy || !plan.steps.length}
              title="Ejecuta los pasos en orden, uno tras otro"
            >
              ▶ Encolar ejecución
            </button>
          </>
        )}
      </div>

      {/* Objective + refined spec */}
      <div className="card" style={{ padding: 18, marginBottom: 16, display: "grid", gap: 14 }}>
        <div>
          <label className="label">Título</label>
          <input
            className="input"
            value={plan.title}
            disabled={locked}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Objetivo / requerimiento crudo</label>
          <textarea
            className="textarea"
            style={{ minHeight: 80 }}
            value={plan.objective}
            disabled={locked}
            onChange={(e) => patch({ objective: e.target.value })}
          />
          {plan.source_url && (
            <div className="hint">
              Origen:{" "}
              <a href={plan.source_url} target="_blank" rel="noreferrer">
                {plan.source_url}
              </a>
            </div>
          )}
        </div>
        <div>
          <label className="label">Requerimiento refinado (global)</label>
          <textarea
            className="textarea"
            style={{ minHeight: 140, fontFamily: "var(--mono, monospace)" }}
            value={plan.refined_spec}
            disabled={locked}
            placeholder="Aún sin refinar. Pulsa “Refinar” para que Claude lo genere usando el contexto del repo."
            onChange={(e) => patch({ refined_spec: e.target.value })}
          />
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
          Pasos ({plan.steps.length})
        </h2>
        {!locked && (
          <button className="btn btn-sm" onClick={addStep} disabled={!!busy}>
            + Agregar paso
          </button>
        )}
      </div>

      {plan.steps.length === 0 ? (
        <div className="card" style={{ padding: 22, textAlign: "center" }}>
          <div className="muted">
            Sin pasos todavía. Refina el plan para descomponerlo en sub-tareas
            ejecutables, o agrégalos manualmente.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {plan.steps.map((s, i) => (
            <div key={s.id} className="card" style={{ padding: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <span
                  className="mono muted"
                  style={{ fontSize: 12, minWidth: 22 }}
                >
                  {i + 1}.
                </span>
                <input
                  className="input"
                  value={s.title}
                  disabled={locked}
                  onChange={(e) => patchStep(s.id, { title: e.target.value })}
                  style={{ flex: 1 }}
                />
                <span className={planStatusBadgeClass(s.status)}>
                  {planStepStatusLabel(s.status)}
                </span>
                {s.clickup_task_id && (
                  <span className="muted" style={{ fontSize: 11 }} title="Subtask en ClickUp">
                    ⇪
                  </span>
                )}
                {!locked && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => removeStep(s.id)}
                    disabled={!!busy}
                  >
                    ✕
                  </button>
                )}
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 72, fontSize: 13 }}
                value={s.spec}
                disabled={locked}
                placeholder="Instrucciones detalladas + criterios de aceptación para este paso."
                onChange={(e) => patchStep(s.id, { spec: e.target.value })}
              />
              {s.result_summary && (
                <details style={{ marginTop: 8 }}>
                  <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
                    Resultado del paso · {timeAgo(s.updated_at)}
                  </summary>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontSize: 12,
                      marginTop: 8,
                      color: "var(--text-muted, #aaa)",
                    }}
                  >
                    {s.result_summary}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 22,
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
        }}
      >
        <button className="btn btn-danger" onClick={remove} disabled={!!busy}>
          Eliminar plan
        </button>
      </div>
    </div>
  );
}
