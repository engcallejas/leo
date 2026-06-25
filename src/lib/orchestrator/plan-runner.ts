import fs from "fs";
import path from "path";
import { UPLOADS_DIR } from "../db";
import { getProvider } from "../integrations";
import {
  addAttachment,
  getPlan,
  getPlanWithSteps,
  listAttachments,
  listPlans,
  listSteps,
  updatePlan,
  updateStep,
  upsertStepTask,
} from "../plan-repo";
import {
  getIntegration,
  getProject,
  getTask,
  listRuns,
  setTaskStatus,
} from "../repo";
import { truncate } from "../integrations/provider";
import type { Plan, PlanStep, Project } from "../types";
import { buildAttachmentBlock } from "./run-config";
import { stopRun } from "./runner";

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

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

async function downloadAttachment(
  url: string,
  token: string,
): Promise<Buffer | null> {
  try {
    let res = await fetch(url);
    if (!res.ok) res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Import the image attachments of the plan's origin ClickUp task as plan
 * attachments (downloaded locally so Claude can Read them and they show in the
 * UI). Idempotent: skips images already imported (by filename).
 */
export async function importClickupAttachments(
  planId: number,
): Promise<{ ok: boolean; imported: number; message: string }> {
  const plan = await getPlan(planId);
  if (!plan) return { ok: false, imported: 0, message: "Plan no encontrado" };
  if (
    plan.source_type !== "clickup" ||
    !plan.source_external_id ||
    !plan.source_integration_id
  ) {
    return { ok: false, imported: 0, message: "El plan no viene de una tarea ClickUp." };
  }
  const integ = await getIntegration(plan.source_integration_id);
  const provider = integ ? getProvider(integ.type) : null;
  if (!integ || !provider?.fetchAttachments) {
    return { ok: false, imported: 0, message: "Proveedor ClickUp incompleto." };
  }
  const config = integ.config as unknown as Record<string, unknown>;
  const token = (config as { token?: string }).token ?? "";

  const atts = await provider.fetchAttachments(config, plan.source_external_id);
  const images = atts.filter(
    (a) => IMG_EXT.has(a.extension) || a.mimetype.startsWith("image/"),
  );

  // Also pull images embedded inline in the description (pasted screenshots,
  // markdown image links) — these aren't in the attachments array.
  if (provider.getTaskDescription) {
    const md = await provider
      .getTaskDescription(config, plan.source_external_id)
      .catch(() => "");
    const seen = new Set(images.map((i) => i.url));
    const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      const url = m[1];
      if (seen.has(url)) continue;
      const clean = url.split("?")[0];
      const ext = (clean.split(".").pop() ?? "").toLowerCase();
      if (IMG_EXT.has(ext) || /clickup|attachment/i.test(url)) {
        const name = decodeURIComponent(clean.split("/").pop() ?? `img.${ext || "png"}`);
        images.push({
          title: name,
          extension: IMG_EXT.has(ext) ? ext : "png",
          url,
          mimetype: "",
        });
        seen.add(url);
      }
    }
  }
  if (!images.length) {
    return { ok: true, imported: 0, message: "La tarea de ClickUp no tiene imágenes adjuntas." };
  }
  const existing = new Set((await listAttachments(planId)).map((a) => a.filename));
  const dir = path.join(UPLOADS_DIR, `plan-${planId}`);
  fs.mkdirSync(dir, { recursive: true });

  let imported = 0;
  for (const img of images) {
    const fname = img.title || `clickup.${img.extension || "png"}`;
    if (existing.has(fname)) continue;
    const buf = await downloadAttachment(img.url, token);
    if (!buf) continue;
    const safe = fname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "img";
    const abs = path.join(dir, `${imported}-${safe}`);
    try {
      fs.writeFileSync(abs, buf);
      await addAttachment({
        plan_id: planId,
        filename: fname,
        path: abs,
        mime: img.mimetype || `image/${img.extension || "png"}`,
        size: buf.length,
      });
      imported++;
    } catch {
      /* skip this one */
    }
  }
  return {
    ok: true,
    imported,
    message: imported
      ? `Importadas ${imported} imagen(es) de ClickUp.`
      : "No se importaron imágenes nuevas (ya estaban o no se pudieron descargar).",
  };
}

const SYNC_MARKER = "## 🦁 Requerimiento refinado por Leo";

/**
 * Write the refined requirement (+ step list) back into the parent ClickUp
 * task's description. Non-destructive: the user's original text is preserved
 * and the Leo block is replaced in place on re-sync. Also drops a comment.
 */
export async function syncPlanToClickUp(
  planId: number,
): Promise<{ ok: boolean; message: string }> {
  const plan = await getPlanWithSteps(planId);
  if (!plan) return { ok: false, message: "Plan no encontrado" };
  if (!plan.refined_spec.trim() && plan.steps.length === 0) {
    return { ok: false, message: "Refina el plan antes de sincronizar." };
  }
  const project = await getProject(plan.project_id);
  if (!project) return { ok: false, message: "Proyecto no encontrado" };

  const cu = await resolveClickUp(plan, project);
  if (!cu) {
    return {
      ok: false,
      message: "El proyecto no tiene una fuente ClickUp configurada.",
    };
  }
  const provider = getProvider("clickup");
  if (!provider.updateTaskDescription || !provider.getTaskDescription) {
    return { ok: false, message: "Proveedor ClickUp incompleto." };
  }

  const taskId =
    plan.source_type === "clickup" && plan.source_external_id
      ? plan.source_external_id
      : plan.clickup_parent_id;
  if (!taskId) {
    return {
      ok: false,
      message:
        "No hay tarea ClickUp destino. Crea las subtasks primero o parte de una tarea ClickUp.",
    };
  }

  const current = await provider.getTaskDescription(cu.config, taskId);
  const base = current
    .split(SYNC_MARKER)[0]
    .replace(/\n*-{3,}\s*$/, "")
    .trimEnd();
  const stepsList = plan.steps
    .map((s, i) => {
      const first = s.spec.split("\n")[0].trim();
      return `${i + 1}. **${s.title}**${first ? ` — ${first}` : ""}`;
    })
    .join("\n");
  const refined = `${SYNC_MARKER}\n\n${plan.refined_spec.trim()}${
    stepsList ? `\n\n### Pasos (${plan.steps.length})\n${stepsList}` : ""
  }`;
  const newDesc = base ? `${base}\n\n---\n\n${refined}` : refined;

  const r = await provider.updateTaskDescription(cu.config, taskId, newDesc);
  if (r.ok && provider.addComment) {
    await provider
      .addComment(
        cu.config,
        taskId,
        `🦁 Leo sincronizó el requerimiento refinado (${plan.steps.length} pasos) en la descripción.`,
      )
      .catch(() => {});
  }
  return {
    ok: r.ok,
    message: r.ok
      ? "Requerimiento refinado sincronizado en la tarea ClickUp."
      : r.message,
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

/**
 * Stop orchestrating a plan and return it to the editable 'refined' state:
 * stop any in-flight step run, reset non-done steps to pending, clear schedule.
 */
export async function cancelPlan(planId: number): Promise<Plan | null> {
  const plan = await getPlanWithSteps(planId);
  if (!plan) return null;
  for (const s of plan.steps) {
    if (s.status === "running" && s.task_id) {
      try {
        const runs = await listRuns({
          task_id: s.task_id,
          status: "running",
          limit: 1,
        });
        if (runs[0]) stopRun(runs[0].id);
        await setTaskStatus(s.task_id, "cancelled");
      } catch {
        /* best-effort */
      }
    }
    if (s.status !== "done") {
      await updateStep(s.id, { status: "pending", task_id: null });
    }
  }
  const hasSteps = plan.steps.length > 0;
  return updatePlan(planId, {
    status: hasSteps ? "refined" : "draft",
    scheduled_for: null,
    error: null,
  });
}

/** The ClickUp status that this project's *development* source listens to. */
export function resolveDevStatus(project: Project): string | null {
  const clickup = project.sources.filter((s) => s.type === "clickup");
  const dev =
    clickup.find((s) => s.role === "development") ??
    clickup.find((s) => s.role === "both") ??
    clickup.find((s) => !s.role || s.role === undefined);
  const statuses = dev?.filter.statuses;
  if (Array.isArray(statuses) && statuses.length) return String(statuses[0]);
  return null;
}

/**
 * Move the plan's origin ClickUp task to the development status, so the dev
 * poller picks it up and the natural development flow takes over.
 */
export async function movePlanToDevStatus(
  planId: number,
): Promise<{ ok: boolean; message: string; status?: string }> {
  const plan = await getPlanWithSteps(planId);
  if (!plan) return { ok: false, message: "Plan no encontrado" };
  const project = await getProject(plan.project_id);
  if (!project) return { ok: false, message: "Proyecto no encontrado" };

  const taskId =
    plan.source_type === "clickup" && plan.source_external_id
      ? plan.source_external_id
      : plan.clickup_parent_id;
  if (!taskId) {
    return {
      ok: false,
      message: "El plan no viene de una tarea ClickUp (ni tiene padre creado).",
    };
  }
  const devStatus = resolveDevStatus(project);
  if (!devStatus) {
    return {
      ok: false,
      message:
        "No hay una fuente ClickUp de *desarrollo* con un estado configurado en el proyecto.",
    };
  }
  const cu = await resolveClickUp(plan, project);
  if (!cu) return { ok: false, message: "Sin configuración ClickUp." };

  const provider = getProvider("clickup");
  if (!provider.resolveTask) {
    return { ok: false, message: "Proveedor ClickUp incompleto." };
  }
  const r = await provider.resolveTask(cu.config, taskId, { status: devStatus });
  if (r.ok) {
    // Refinement is done — the plan is now handed off to the ClickUp dev flow.
    await updatePlan(planId, { status: "dispatched", error: null });
  }
  return {
    ok: r.ok,
    status: devStatus,
    message: r.ok
      ? `Tarea movida a "${devStatus}". Refinamiento cerrado — lo ejecuta desarrollo desde ClickUp.`
      : r.message,
  };
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
  const attBlock = buildAttachmentBlock(await listAttachments(plan.id));
  const description = `${step.spec.trim()}\n\n${context}${attBlock ? `\n\n${attBlock}` : ""}`;

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
