import { badRequest, json, notFound, parse, serverError } from "@/lib/api";
import { deleteStep, getPlan, getStep, updateStep } from "@/lib/plan-repo";
import { planStepInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id, stepId } = await params;
  const plan = await getPlan(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  if (plan.status === "running" || plan.status === "queued") {
    return badRequest("No se pueden editar pasos mientras el plan está activo.");
  }
  const step = await getStep(Number(stepId));
  if (!step || step.plan_id !== Number(id)) return notFound("Paso no encontrado");
  const p = await parse(req, planStepInputSchema);
  if ("error" in p) return p.error;
  try {
    const updated = await updateStep(Number(stepId), {
      title: p.data.title,
      spec: p.data.spec ?? "",
    });
    return json(updated);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, stepId } = await params;
  const plan = await getPlan(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  if (plan.status === "running" || plan.status === "queued") {
    return badRequest("No se pueden borrar pasos mientras el plan está activo.");
  }
  const step = await getStep(Number(stepId));
  if (!step || step.plan_id !== Number(id)) return notFound("Paso no encontrado");
  try {
    await deleteStep(Number(stepId));
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
