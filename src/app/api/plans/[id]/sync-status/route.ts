import { json, serverError } from "@/lib/api";
import { syncDispatchedPlan } from "@/lib/orchestrator/plan-runner";
import { getPlanWithSteps } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Check the plan's origin ClickUp task and, if development has completed it,
 * mark the plan as done. Returns { ok, completed, status, message, plan }.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const result = await syncDispatchedPlan(Number(id));
    return json({ ...result, plan: await getPlanWithSteps(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
