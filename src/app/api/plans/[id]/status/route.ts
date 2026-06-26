import { badRequest, json, notFound, serverError } from "@/lib/api";
import {
  getPlan,
  getPlanWithSteps,
  setPlanClosed,
  updatePlan,
} from "@/lib/plan-repo";
import type { PlanStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const PLAN_STATUSES: PlanStatus[] = [
  "draft",
  "refining",
  "refined",
  "queued",
  "running",
  "dispatched",
  "done",
  "failed",
  "cancelled",
];

/**
 * Manual board override: force a plan into any state (status and/or closed flag).
 * Used by the board's free drag-between-columns. Body: { status?, closed? }.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const plan = await getPlan(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  let body: { status?: string; closed?: boolean };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido en el body");
  }
  try {
    if (body.status) {
      if (!PLAN_STATUSES.includes(body.status as PlanStatus)) {
        return badRequest(`Estado inválido: ${body.status}`);
      }
      await updatePlan(Number(id), { status: body.status as PlanStatus });
    }
    if (typeof body.closed === "boolean") {
      await setPlanClosed(Number(id), body.closed);
    }
    return json({ ok: true, plan: await getPlanWithSteps(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
