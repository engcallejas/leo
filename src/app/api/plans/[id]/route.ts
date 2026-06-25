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
    // Promote draft/failed → refined only when there are actually steps to run
    // (saving an empty step list must not pretend the plan is refined).
    const promote =
      !!body.steps &&
      body.steps.length > 0 &&
      (plan.status === "draft" || plan.status === "failed");
    await updatePlan(planId, {
      title: body.title,
      objective: body.objective,
      refined_spec: body.refined_spec,
      ...(promote ? { status: "refined" as const, error: null } : {}),
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
