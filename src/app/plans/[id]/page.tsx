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
import { Markdown } from "@/components/Markdown";
import { PlanAttachments } from "@/components/PlanAttachments";
import { PlanInteractions } from "@/components/PlanInteractions";
import { RefineProgress } from "@/components/RefineProgress";
import { SpecViewer } from "@/components/SpecViewer";
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
  const [devStatus, setDevStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    const p = await api.get(`/api/plans/${id}`);
    setPlan(p);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  const projectId = plan?.project_id;
  useEffect(() => {
    if (!projectId) return;
    api
      .get(`/api/projects/${projectId}`)
      .then((p) => setDevStatus(devStatusOf(p)))
      .catch(() => {});
  }, [projectId]);

  // Live-poll while refining / queued / running, unless mid-edit.
  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current || editing) return;
      if (plan && !LIVE.has(plan.status)) return;
      load().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [plan, load, editing]);

  if (!plan) {
    return (
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <Header title="Plan" />
        {err ? <ErrorBar text={err} /> : <div className="muted">Cargando…</div>}
        <Link href="/plans" className="btn">
          ← Volver
        </Link>
      </div>
    );
  }

  const status = plan.status;
  const refining = status === "refining";
  const running = status === "running" || status === "queued";
  const dispatched = status === "dispatched";
  const done = status === "done";
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const hasSteps = plan.steps.length > 0;
  const hasRefined = plan.refined_spec.trim().length > 0 || hasSteps;
  const locked = running || refining || dispatched;
  const inputPhase = !hasRefined && !refining; // draft or failed-without-steps
  const editable = !locked && (inputPhase || editing);

  const doneCount = plan.steps.filter((s) => s.status === "done").length;

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

  const save = (exitEdit = false) =>
    act("save", async () => {
      const updated = await api.put(`/api/plans/${id}`, {
        title: plan.title,
        objective: plan.objective,
        refined_spec: plan.refined_spec,
        steps: plan.steps.map((s) => ({ title: s.title, spec: s.spec })),
      });
      dirty.current = false;
      setPlan(updated);
      if (exitEdit) setEditing(false);
      setMsg("Guardado.");
    });

  const cancelEdit = () =>
    act("canceledit", async () => {
      dirty.current = false;
      setEditing(false);
      await load();
    });

  const refine = () =>
    act("refine", async () => {
      if (dirty.current) {
        await api.put(`/api/plans/${id}`, {
          title: plan.title,
          objective: plan.objective,
        });
        dirty.current = false;
      }
      const p = await api.post(`/api/plans/${id}/refine`);
      setPlan(p.steps ? p : { ...plan, ...p, steps: plan.steps });
      // No toast: the "Refinando…" hero already communicates this, and a lingering
      // toast would reappear (stale) once refining ends.
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

  const syncClickup = () =>
    act("sync", async () => {
      const r = await api.post(`/api/plans/${id}/sync-clickup`);
      if (r.plan) setPlan(r.plan);
      setMsg(r.message || "Listo.");
    });

  const moveToDev = () =>
    act("movedev", async () => {
      const r = await api.post(`/api/plans/${id}/move-to-dev`);
      if (r.plan) setPlan(r.plan);
      setMsg(r.message || "Listo.");
    });

  const resyncClickup = () =>
    act("resync", async () => {
      const r = await api.post(`/api/plans/${id}/resync-clickup`);
      if (r.plan) {
        dirty.current = false;
        setPlan(r.plan);
      }
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

  // ---- phase index for the stepper ----
  let phaseIdx = 0;
  if (refining || inputPhase) phaseIdx = 0;
  else if (status === "refined" || ((failed || cancelled) && hasSteps)) phaseIdx = 1;
  else if (running) phaseIdx = 2;
  else if (dispatched) phaseIdx = 2;
  else if (done) phaseIdx = 3;

  const isClickup = plan.source_type === "clickup";

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <Header
        title={plan.title || "Plan sin título"}
        subtitle={`Plan #${plan.id} · origen ${plan.source_type}${
          hasSteps ? ` · ${doneCount}/${plan.steps.length} pasos` : ""
        }`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={planStatusBadgeClass(status)}>
              {planStatusLabel(status)}
            </span>
            <Link href="/plans" className="btn">
              ← Volver
            </Link>
          </div>
        }
      />

      <PhaseStepper current={phaseIdx} />

      {err && <ErrorBar text={err} />}
      {plan.error && failed && <ErrorBar text={plan.error} />}
      {msg && !refining && (
        <div
          className="card"
          style={{
            padding: "9px 12px",
            marginBottom: 14,
            fontSize: 13,
            borderColor: "var(--ok)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{msg}</span>
          <button
            className="btn btn-sm"
            style={{ border: "none", background: "transparent" }}
            onClick={() => setMsg(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ---- NEXT ACTION HERO ---- */}
      <NextAction
        tone={
          refining || running || dispatched
            ? "running"
            : done
              ? "ok"
              : "accent"
        }
        icon={
          refining
            ? "✦"
            : running
              ? "▶"
              : dispatched
                ? "🚀"
                : done
                  ? "✓"
                  : inputPhase
                    ? "✦"
                    : "▶"
        }
        title={
          refining
            ? "Refinando el requerimiento…"
            : running
              ? "Ejecutando pasos…"
              : dispatched
                ? "En manos de desarrollo (ClickUp)"
                : done
                  ? "Plan completado"
                  : inputPhase
                    ? failed
                      ? "El refinamiento falló — reintenta"
                      : "Paso 1: refina el requerimiento"
                    : "Listo para ejecutar"
        }
        body={
          refining
            ? "Claude está leyendo el repo (solo lectura) y te preguntará si algo es ambiguo. Mira el progreso abajo."
            : running
              ? `${doneCount}/${plan.steps.length} pasos completados. Cada paso corre en su propia sesión con el contexto acumulado de los anteriores.`
              : dispatched
                ? `Este plan se movió${devStatus ? ` a "${devStatus}"` : ""} y lo ejecuta desarrollo desde ClickUp. Vuelve a refinado si necesitas retomarlo en Leo.`
                : done
                  ? `Los ${plan.steps.length} pasos terminaron. Revisa el resultado de cada uno más abajo.`
                  : inputPhase
                    ? "Claude analiza el repo (solo lectura) y propone un requerimiento claro y los pasos ejecutables. No modifica nada."
                    : "Encola los pasos para ejecutarlos en orden, o prográmalos para más tarde. Revisa el spec y los pasos antes."
        }
      >
        {/* primary + inline secondary actions, by phase */}
        {refining ? null : running ? (
          <button className="btn btn-danger" onClick={cancel} disabled={!!busy}>
            {busy === "cancel" ? "Deteniendo…" : "■ Detener"}
          </button>
        ) : dispatched ? (
          <button className="btn" onClick={cancel} disabled={!!busy}>
            {busy === "cancel" ? "…" : "↺ Volver a refinado"}
          </button>
        ) : inputPhase ? (
          <button
            className="btn btn-primary"
            onClick={refine}
            disabled={!!busy}
            style={{ fontSize: 14, padding: "9px 16px" }}
          >
            {busy === "refine" ? "Iniciando…" : failed ? "↻ Refinar de nuevo" : "✦ Refinar requerimiento"}
          </button>
        ) : done ? (
          <button
            className="btn"
            onClick={() => enqueue(null)}
            disabled={!!busy || !hasSteps}
            title="Volver a ejecutar todos los pasos"
          >
            ↻ Re-ejecutar
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={() => enqueue(null)}
              disabled={!!busy || !hasSteps}
              style={{ fontSize: 14, padding: "9px 16px" }}
              title="Ejecuta los pasos en orden, uno tras otro"
            >
              {busy === "enqueue" ? "Encolando…" : "▶ Encolar ejecución"}
            </button>
            <div style={{ width: 1, height: 26, background: "var(--border)" }} />
            <input
              type="datetime-local"
              className="input"
              style={{ width: 190 }}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <button
              className="btn"
              onClick={() => enqueue(when ? new Date(when).toISOString() : null)}
              disabled={!!busy || !hasSteps || !when}
              title="Programa la orquestación para la fecha/hora indicada"
            >
              🕑 Programar
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-sm"
              onClick={refine}
              disabled={!!busy}
              title="Vuelve a refinar desde cero con Claude"
            >
              ↻ Re-refinar
            </button>
            {(failed || cancelled) && (
              <button
                className="btn btn-sm"
                onClick={cancel}
                disabled={!!busy}
                title="Resetea los pasos a pendiente"
              >
                ↺ Reiniciar pasos
              </button>
            )}
          </>
        )}
      </NextAction>

      {/* ---- LIVE: interactions + refine progress (only while refining) ---- */}
      {refining && (
        <>
          <PlanInteractions planId={plan.id} active={refining} />
          <RefineProgress planId={plan.id} refining={refining} />
        </>
      )}
      {/* When not refining, keep the analysis available but collapsed. */}
      {!refining && plan.refine_log && (
        <RefineProgress planId={plan.id} refining={false} />
      )}

      {/* ---- CONTENT (hidden while refining to keep the view focused) ---- */}
      {!refining && (
        <>
      {/* ---- INPUT PHASE: the seed form ---- */}
      {inputPhase ? (
        <Section title="Requerimiento a refinar" subtitle="Lo que Claude usará como punto de partida">
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label className="label">Título</label>
              <input
                className="input"
                value={plan.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Título corto del requerimiento"
              />
            </div>
            <div>
              <label className="label">Objetivo / requerimiento crudo</label>
              <textarea
                className="textarea"
                style={{ minHeight: 110, fontFamily: "inherit", fontSize: 13.5 }}
                value={plan.objective}
                onChange={(e) => patch({ objective: e.target.value })}
                placeholder="Describe qué necesitas. Claude lo aterrizará contra el código real del repo."
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
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" onClick={() => save()} disabled={!!busy || !dirty.current}>
                {busy === "save" ? "Guardando…" : "Guardar borrador"}
              </button>
              {isClickup && (
                <button
                  className="btn btn-sm"
                  onClick={resyncClickup}
                  disabled={!!busy}
                  title="Trae el título, la descripción y las imágenes más recientes de la tarea de ClickUp"
                >
                  {busy === "resync" ? "Trayendo…" : "⟲ Traer de ClickUp"}
                </button>
              )}
            </div>
          </div>
        </Section>
      ) : (
        <>
          {/* ---- REVIEW PHASE ---- */}
          {editing && (
            <div
              className="card"
              style={{
                padding: "10px 14px",
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                border: "1px solid var(--accent)",
                background: "var(--panel-2)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>✎ Editando el plan</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={cancelEdit} disabled={!!busy}>
                  Cancelar
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => save(true)} disabled={!!busy}>
                  {busy === "save" ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          )}

          {/* Refined requirement (rendered) */}
          <Section
            title="Requerimiento refinado"
            subtitle="El spec global que guía toda la ejecución"
            right={
              !locked && !editing ? (
                <button className="btn btn-sm" onClick={() => setEditing(true)}>
                  ✎ Editar
                </button>
              ) : undefined
            }
          >
            {editable ? (
              <textarea
                className="textarea"
                style={{ minHeight: 180 }}
                value={plan.refined_spec}
                onChange={(e) => patch({ refined_spec: e.target.value })}
                placeholder="Aún sin refinar."
              />
            ) : plan.refined_spec.trim() ? (
              <Markdown text={plan.refined_spec} />
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                Sin spec global. Los pasos de abajo contienen el detalle.
              </div>
            )}
          </Section>

          {/* Seed (collapsed) */}
          <Collapsible summary="Requerimiento original (semilla)">
            <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
              {editable ? (
                <>
                  <div>
                    <label className="label">Título</label>
                    <input
                      className="input"
                      value={plan.title}
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Objetivo / requerimiento crudo</label>
                    <textarea
                      className="textarea"
                      style={{ minHeight: 80, fontFamily: "inherit" }}
                      value={plan.objective}
                      onChange={(e) => patch({ objective: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0 }}>
                  {plan.objective || <span className="muted">—</span>}
                </p>
              )}
              {plan.source_url && (
                <div className="hint">
                  Origen:{" "}
                  <a href={plan.source_url} target="_blank" rel="noreferrer">
                    {plan.source_url}
                  </a>
                </div>
              )}
            </div>
          </Collapsible>

          {/* Steps */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: "22px 0 10px",
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
              Pasos{" "}
              <span className="muted" style={{ fontWeight: 500 }}>
                ({plan.steps.length})
              </span>
            </h2>
            {editable && (
              <button className="btn btn-sm" onClick={addStep} disabled={!!busy}>
                + Agregar paso
              </button>
            )}
          </div>

          {plan.steps.length === 0 ? (
            <div className="card" style={{ padding: 22, textAlign: "center" }}>
              <div className="muted" style={{ fontSize: 13 }}>
                Sin pasos. Re-refina para descomponer el plan, o edítalo para
                agregarlos a mano.
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {plan.steps.map((s, i) => (
                <StepCard
                  key={s.id}
                  step={s}
                  index={i}
                  editable={editable}
                  busy={!!busy}
                  onPatch={(sp) => patchStep(s.id, sp)}
                  onRemove={() => removeStep(s.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ---- CONTEXT (attachments + specs) ---- */}
      <div style={{ marginTop: 22 }}>
        <PlanAttachments planId={plan.id} clickupOrigin={isClickup} />
        <SpecViewer projectId={plan.project_id} />
      </div>

      {/* ---- CLICKUP INTEGRATION ---- */}
      {isClickup && !inputPhase && (
        <Section title="Integración ClickUp" subtitle="Acciones opcionales sobre la tarea origen">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              className="btn btn-sm"
              onClick={resyncClickup}
              disabled={!!busy || locked}
              title="Trae la versión más reciente de la tarea de ClickUp (título, descripción e imágenes) al plan"
            >
              {busy === "resync" ? "Trayendo…" : "⟲ Traer cambios de ClickUp"}
            </button>
            <button
              className="btn btn-sm"
              onClick={syncClickup}
              disabled={!!busy || !plan.refined_spec.trim() || locked}
              title="Escribe el requerimiento refinado en la descripción de la tarea ClickUp"
            >
              {busy === "sync" ? "Sincronizando…" : "⟳ Sincronizar refinado"}
            </button>
            <button
              className="btn btn-sm"
              onClick={pushClickup}
              disabled={!!busy || !hasSteps || locked}
              title="Crea cada paso como subtask en ClickUp bajo la tarea padre"
            >
              {busy === "clickup" ? "Enviando…" : "⇪ Crear subtasks"}
            </button>
            {devStatus && (
              <button
                className="btn btn-sm"
                onClick={moveToDev}
                disabled={!!busy || locked}
                title={`Mueve la tarea al estado "${devStatus}" que escucha desarrollo`}
              >
                {busy === "movedev" ? "Moviendo…" : `→ Mover a "${devStatus}"`}
              </button>
            )}
          </div>
        </Section>
      )}
        </>
      )}

      {/* ---- DANGER ZONE (always available, any stage) ---- */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 24,
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
        }}
      >
        <button className="btn btn-danger btn-sm" onClick={remove} disabled={!!busy}>
          Eliminar plan
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presentational helpers                                              */
/* ------------------------------------------------------------------ */

const PHASES = [
  { t: "Refinar", d: "Claude propone spec + pasos" },
  { t: "Revisar", d: "Ajusta el spec y los pasos" },
  { t: "Ejecutar", d: "Encola o programa la corrida" },
  { t: "Resultados", d: "Revisa lo que se hizo" },
];

function PhaseStepper({ current }: { current: number }) {
  return (
    <div
      className="card"
      style={{
        padding: 8,
        marginBottom: 16,
        display: "flex",
        alignItems: "stretch",
        gap: 4,
      }}
    >
      {PHASES.map((p, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <div
            key={i}
            style={{
              flex: "1 1 0",
              padding: "8px 10px",
              borderRadius: 8,
              background: state === "active" ? "var(--panel-2)" : "transparent",
              opacity: state === "todo" ? 0.5 : 1,
              display: "flex",
              gap: 9,
              alignItems: "center",
              minWidth: 0,
            }}
          >
            <span
              style={{
                flex: "0 0 auto",
                width: 20,
                height: 20,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
                background:
                  state === "done"
                    ? "var(--ok)"
                    : state === "active"
                      ? "var(--accent)"
                      : "var(--border)",
                color: state === "todo" ? "var(--muted)" : "var(--accent-fg)",
              }}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                {p.t}
              </div>
              <div
                className="muted"
                style={{
                  fontSize: 11,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.d}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NextAction({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: "accent" | "running" | "ok";
  icon: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const color =
    tone === "running" ? "var(--running)" : tone === "ok" ? "var(--ok)" : "var(--accent)";
  return (
    <div
      className="card"
      style={{
        padding: 16,
        marginBottom: 16,
        borderColor: color,
        boxShadow: `inset 3px 0 0 ${color}`,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span style={{ fontSize: 18, lineHeight: 1.3, color }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.55 }}>
            {body}
          </div>
        </div>
      </div>
      {children && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            marginTop: 14,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{title}</h2>
          {subtitle && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Collapsible({
  summary,
  children,
}: {
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="card" style={{ padding: "12px 16px", marginBottom: 16 }}>
      <summary
        style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, listStyle: "none" }}
      >
        ▸ {summary}
      </summary>
      {children}
    </details>
  );
}

function StepCard({
  step,
  index,
  editable,
  busy,
  onPatch,
  onRemove,
}: {
  step: PlanStep;
  index: number;
  editable: boolean;
  busy: boolean;
  onPatch: (p: Partial<PlanStep>) => void;
  onRemove: () => void;
}) {
  const s = step;
  const accent =
    s.status === "done"
      ? "var(--ok)"
      : s.status === "failed"
        ? "var(--danger)"
        : s.status === "running"
          ? "var(--running)"
          : "var(--border)";
  return (
    <div
      className="card"
      style={{ padding: 14, boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: editable ? 8 : 6 }}>
        <span
          style={{
            flex: "0 0 auto",
            width: 22,
            height: 22,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            fontSize: 11.5,
            fontWeight: 700,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
          }}
        >
          {index + 1}
        </span>
        {editable ? (
          <input
            className="input"
            value={s.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            style={{ flex: 1 }}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{s.title}</span>
        )}
        <span className={planStatusBadgeClass(s.status)}>
          {planStepStatusLabel(s.status)}
        </span>
        {s.clickup_task_id && (
          <span className="muted" style={{ fontSize: 11 }} title="Subtask en ClickUp">
            ⇪
          </span>
        )}
        {editable && (
          <button
            className="btn btn-sm btn-danger"
            onClick={onRemove}
            disabled={busy}
            title="Eliminar paso"
          >
            ✕
          </button>
        )}
      </div>

      {editable ? (
        <textarea
          className="textarea"
          style={{ minHeight: 72, fontSize: 13 }}
          value={s.spec}
          onChange={(e) => onPatch({ spec: e.target.value })}
          placeholder="Instrucciones detalladas + criterios de aceptación."
        />
      ) : (
        s.spec.trim() && (
          <div style={{ paddingLeft: 32 }}>
            <Markdown text={s.spec} size={13} />
          </div>
        )
      )}

      {!editable && s.result_summary && (
        <div
          style={{
            marginTop: 10,
            marginLeft: 32,
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: "var(--ok)",
              marginBottom: 6,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>✓ RESULTADO</span>
            <span className="muted" style={{ fontWeight: 500 }}>
              {timeAgo(s.updated_at)}
            </span>
          </div>
          <Markdown text={s.result_summary} size={12.5} />
        </div>
      )}
    </div>
  );
}

/** The project's development ClickUp status (first status of its dev source). */
function devStatusOf(project: {
  sources?: { type: string; role?: string; filter: Record<string, unknown> }[];
}): string | null {
  const clickup = (project.sources ?? []).filter((s) => s.type === "clickup");
  const dev =
    clickup.find((s) => s.role === "development") ??
    clickup.find((s) => s.role === "both") ??
    clickup.find((s) => !s.role);
  const st = dev?.filter?.statuses;
  return Array.isArray(st) && st.length ? String(st[0]) : null;
}
