import { badRequest, json, notFound, parse, serverError } from "@/lib/api";
import {
  deletePlan,
  getPlan,
  getPlanWithSteps,
  replaceSteps,
  updatePlan,
} from "@/lib/plan-repo";
import { planUpdateSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const plan = await getPlanWithSteps(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  return json(plan);
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const planId = Number(id);
  const plan = await getPlan(planId);
  if (!plan) return notFound("Plan no encontrado");

  const p = await parse(req, planUpdateSchema);
  if ("error" in p) return p.error;
  const body = p.data;

  try {
    if (body.steps) {
      if (plan.status === "running" || plan.status === "queued") {
        return badRequest(
          "No se pueden editar los pasos mientras el plan está en ejecución o en cola.",
        );
      }
      await replaceSteps(planId, body.steps.map((s) => ({
        title: s.title,
        spec: s.spec ?? "",
      })));
    }
    await updatePlan(planId, {
      title: body.title,
      objective: body.objective,
      refined_spec: body.refined_spec,
      // Editing a draft/refined plan keeps it in the 'refined' lane.
      ...(body.steps && (plan.status === "draft" || plan.status === "failed")
        ? { status: "refined" as const }
        : {}),
    });
    return json(await getPlanWithSteps(planId));
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deletePlan(Number(id));
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
