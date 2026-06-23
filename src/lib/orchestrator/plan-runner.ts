import { getProvider } from "../integrations";
import {
  getPlan,
  getPlanWithSteps,
  listPlans,
  listSteps,
  updatePlan,
  updateStep,
  upsertStepTask,
} from "../plan-repo";
import { getIntegration, getProject, getTask, listRuns } from "../repo";
import { truncate } from "../integrations/provider";
import type { Plan, PlanStep, Project } from "../types";

// planTick runs from the scheduler loop; guard against overlap.
const g = globalThis as unknown as { __leoPlanTicking?: boolean };

/** Find the project's ClickUp integration + a target list for pushing steps. */
async function resolveClickUp(
  plan: Plan,
  project: Project,
): Promise<{
  integrationId: number;
  config: Record<string, unknown>;
  listId: string | null;
} | null> {
  // Prefer the plan's own ClickUp origin, else any ClickUp source on the project.
  let integrationId = plan.source_integration_id;
  let listId: string | null = null;

  const clickupSources = project.sources.filter((s) => s.type === "clickup");
  if (!integrationId) {
    const src = clickupSources[0];
    if (!src) return null;
    integrationId = src.integration_id;
    listId = (src.filter.listId as string) ?? null;
  } else {
    const src =
      clickupSources.find((s) => s.integration_id === integrationId) ??
      clickupSources[0];
    listId = (src?.filter.listId as string) ?? null;
  }

  const integ = await getIntegration(integrationId);
  if (!integ || integ.type !== "clickup") return null;
  return {
    integrationId,
    config: integ.config as unknown as Record<string, unknown>,
    listId,
  };
}

/**
 * Create the parent task (if needed) and one ClickUp subtask per step. The
 * originating ClickUp task becomes the parent; for manual plans a parent task
 * is created in the project's ClickUp list.
 */
export async function pushPlanToClickUp(
  planId: number,
): Promise<{ ok: boolean; message: string; created: number }> {
  const plan = await getPlanWithSteps(planId);
  if (!plan) return { ok: false, message: "Plan no encontrado", created: 0 };
  const project = await getProject(plan.project_id);
  if (!project) return { ok: false, message: "Proyecto no encontrado", created: 0 };

  const cu = await resolveClickUp(plan, project);
  if (!cu) {
    return {
      ok: false,
      message: "El proyecto no tiene una fuente ClickUp configurada.",
      created: 0,
    };
  }
  const provider = getProvider("clickup");
  if (!provider.createTask || !provider.getTaskMeta) {
    return { ok: false, message: "Proveedor ClickUp incompleto.", created: 0 };
  }

  // Resolve parent task + the list it lives in.
  let parentId = plan.clickup_parent_id;
  let listId = cu.listId;
  if (plan.source_type === "clickup" && plan.source_external_id) {
    parentId = plan.source_external_id;
    const meta = await provider.getTaskMeta(cu.config, parentId);
    if (meta.listId) listId = meta.listId;
  } else if (!parentId) {
    if (!listId) {
      return {
        ok: false,
        message:
          "Sin lista ClickUp destino. Configura una fuente ClickUp con lista en el proyecto.",
        created: 0,
      };
    }
    const parent = await provider.createTask(cu.config, listId, {
      name: plan.title,
      description: plan.refined_spec || plan.objective,
    });
    parentId = parent.id;
    await updatePlan(planId, { clickup_parent_id: parentId });
  }
  if (!listId) {
    const meta = parentId ? await provider.getTaskMeta(cu.config, parentId) : null;
    listId = meta?.listId ?? null;
  }
  if (!parentId || !listId) {
    return {
      ok: false,
      message: "No se pudo resolver la tarea padre o su lista en ClickUp.",
      created: 0,
    };
  }

  let created = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (step.clickup_task_id) continue; // already pushed
    const sub = await provider.createTask(cu.config, listId, {
      name: `${i + 1}. ${step.title}`,
      description: step.spec,
      parentId,
    });
    await updateStep(step.id, { clickup_task_id: sub.id });
    created++;
  }

  await updatePlan(planId, { clickup_parent_id: parentId });
  return {
    ok: true,
    message: `Creadas ${created} subtask(s) en ClickUp bajo la tarea padre.`,
    created,
  };
}

/** Move a plan into the orchestration queue. Resets non-done steps to pending. */
export async function enqueuePlan(
  planId: number,
  scheduledFor: string | null,
): Promise<Plan | null> {
  const plan = await getPlanWithSteps(planId);
  if (!plan) return null;
  if (plan.steps.length === 0) {
    return updatePlan(planId, {
      status: "failed",
      error: "El plan no tiene pasos. Refínalo primero.",
    });
  }
  for (const s of plan.steps) {
    if (s.status !== "done") {
      await updateStep(s.id, { status: "pending" });
    }
  }
  return updatePlan(planId, {
    status: "queued",
    scheduled_for: scheduledFor,
    error: null,
  });
}

export async function cancelPlan(planId: number): Promise<Plan | null> {
  const plan = await getPlanWithSteps(planId);
  if (!plan) return null;
  for (const s of plan.steps) {
    if (s.status === "pending" || s.status === "queued") {
      await updateStep(s.id, { status: "skipped" });
    }
  }
  return updatePlan(planId, { status: "cancelled" });
}

/** Cumulative context handed to a step: refined spec + prior step summaries. */
function buildStepContext(
  plan: Plan,
  step: PlanStep,
  allSteps: PlanStep[],
): string {
  const ordered = [...allSteps].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((s) => s.id === step.id);
  const done = ordered.filter((s) => s.status === "done");

  const parts: string[] = [
    `## Plan: ${plan.title}`,
    `Eres un agente ejecutando el paso ${index + 1} de ${ordered.length} de un plan más grande, de forma autónoma y secuencial.`,
  ];
  if (plan.refined_spec.trim()) {
    parts.push(
      `\n### Requerimiento refinado (visión global del plan)`,
      truncate(plan.refined_spec, 4000),
    );
  }
  if (done.length) {
    const lines = done.map((s, i) => {
      const summary = (s.result_summary || "(sin resumen)").trim();
      return `#### Paso completado ${i + 1}: ${s.title}\n${truncate(summary, 1500)}`;
    });
    parts.push(
      `\n### Contexto acumulado de pasos previos (ya completados)`,
      `Apóyate en lo ya hecho; no rehagas su trabajo. Mantén consistencia con esos cambios.`,
      lines.join("\n\n"),
    );
  }
  parts.push(
    `\n### Tu paso ahora`,
    `Implementa ÚNICAMENTE este paso de forma completa y verifícalo. No avances a pasos posteriores.`,
  );
  return parts.join("\n");
}

/** Create the Leo task that executes a step (queued so the scheduler runs it). */
async function dispatchStep(
  plan: Plan,
  step: PlanStep,
  allSteps: PlanStep[],
): Promise<void> {
  const context = buildStepContext(plan, step, allSteps);
  const description = `${step.spec.trim()}\n\n${context}`;

  let taskId: number;
  if (step.clickup_task_id) {
    // Resolve the subtask's list so resolve-on-done can move it correctly.
    let listId: string | null = null;
    try {
      const provider = getProvider("clickup");
      if (plan.source_integration_id && provider.getTaskMeta) {
        const integ = await getIntegration(plan.source_integration_id);
        if (integ) {
          const meta = await provider.getTaskMeta(
            integ.config as unknown as Record<string, unknown>,
            step.clickup_task_id,
          );
          listId = meta.listId;
        }
      }
    } catch {
      /* best-effort */
    }
    taskId = await upsertStepTask({
      project_id: plan.project_id,
      source_type: "clickup",
      integration_id: plan.source_integration_id,
      external_id: step.clickup_task_id,
      title: step.title,
      description,
      url: null,
      raw: { id: step.clickup_task_id, list: listId ? { id: listId } : undefined },
    });
  } else {
    taskId = await upsertStepTask({
      project_id: plan.project_id,
      source_type: "manual",
      integration_id: null,
      external_id: `plan-${plan.id}-step-${step.id}`,
      title: step.title,
      description,
      url: null,
      raw: { plan_id: plan.id, step_id: step.id },
    });
  }

  await updateStep(step.id, { status: "queued", task_id: taskId });
  await updatePlan(plan.id, { status: "running", error: null });
}

/** Post a comment on the step's ClickUp subtask with its result summary. */
async function commentStepDone(
  plan: Plan,
  step: PlanStep,
  summary: string,
): Promise<void> {
  if (!step.clickup_task_id || !plan.source_integration_id) return;
  try {
    const provider = getProvider("clickup");
    if (!provider.addComment) return;
    const integ = await getIntegration(plan.source_integration_id);
    if (!integ) return;
    await provider.addComment(
      integ.config as unknown as Record<string, unknown>,
      step.clickup_task_id,
      `🦁 Leo completó este paso.\n\n${truncate(summary || "(sin resumen)", 4000)}`,
    );
  } catch {
    /* best-effort */
  }
}

async function onPlanComplete(plan: Plan): Promise<void> {
  if (!plan.clickup_parent_id || !plan.source_integration_id) return;
  try {
    const provider = getProvider("clickup");
    if (!provider.addComment) return;
    const integ = await getIntegration(plan.source_integration_id);
    if (!integ) return;
    await provider.addComment(
      integ.config as unknown as Record<string, unknown>,
      plan.clickup_parent_id,
      `🦁 Leo completó el plan "${plan.title}": todos los pasos terminaron correctamente.`,
    );
  } catch {
    /* best-effort */
  }
}

/** Advance one plan by at most one transition (finalize a step or dispatch the next). */
async function advancePlan(plan: Plan): Promise<void> {
  const steps = await listSteps(plan.id);

  // 1) Reconcile a dispatched step that may have finished.
  const active = steps.find(
    (s) => s.task_id && (s.status === "queued" || s.status === "running"),
  );
  if (active && active.task_id) {
    const task = await getTask(active.task_id);
    const tStatus = task?.status;
    if (!task) {
      await updateStep(active.id, { status: "failed" });
      await updatePlan(plan.id, {
        status: "failed",
        error: `La tarea del paso "${active.title}" desapareció.`,
      });
      return;
    }
    if (tStatus === "running" || tStatus === "queued" || tStatus === "pending") {
      if (tStatus === "running" && active.status !== "running") {
        await updateStep(active.id, { status: "running" });
      }
      return; // still in flight — wait
    }
    // Finished: capture the latest run summary.
    const runs = await listRuns({ task_id: active.task_id, limit: 1 });
    const summary = runs[0]?.result_summary ?? "";
    if (tStatus === "done") {
      await updateStep(active.id, { status: "done", result_summary: summary });
      await commentStepDone(plan, active, summary);
      // fall through to dispatch the next step
    } else {
      await updateStep(active.id, { status: "failed", result_summary: summary });
      await updatePlan(plan.id, {
        status: "failed",
        error: `El paso "${active.title}" falló. Revisa su ejecución.`,
      });
      return;
    }
  }

  // 2) Dispatch the next pending step, or finish the plan.
  const fresh = await listSteps(plan.id);
  if (fresh.some((s) => s.status === "queued" || s.status === "running")) return;
  const next = fresh.find((s) => s.status === "pending");
  if (!next) {
    const allSettled = fresh.every(
      (s) => s.status === "done" || s.status === "skipped",
    );
    const anyDone = fresh.some((s) => s.status === "done");
    if (allSettled && anyDone) {
      await updatePlan(plan.id, { status: "done", error: null });
      await onPlanComplete(plan);
    }
    return;
  }
  const project = await getProject(plan.project_id);
  if (!project || !project.enabled) return; // can't run; leave queued
  await dispatchStep(plan, next, fresh);
}

/** Scheduler hook: advance all active plans. Safe to call frequently. */
export async function planTick(): Promise<void> {
  if (g.__leoPlanTicking) return;
  g.__leoPlanTicking = true;
  try {
    const queued = await listPlans({ status: "queued", limit: 200 });
    const running = await listPlans({ status: "running", limit: 200 });
    const now = Date.now();
    const due = (iso: string | null) => !iso || new Date(iso).getTime() <= now;
    for (const plan of [...running, ...queued]) {
      if (!due(plan.scheduled_for)) continue;
      try {
        // Re-read in case another transition already moved it this tick.
        const fresh = await getPlan(plan.id);
        if (fresh && (fresh.status === "queued" || fresh.status === "running")) {
          await advancePlan(fresh);
        }
      } catch {
        /* keep other plans moving */
      }
    }
  } finally {
    g.__leoPlanTicking = false;
  }
}
