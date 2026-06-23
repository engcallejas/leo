import { json, notFound, serverError } from "@/lib/api";
import { cancelPlan } from "@/lib/orchestrator/plan-runner";
import { getPlanWithSteps } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const plan = await cancelPlan(Number(id));
    if (!plan) return notFound("Plan no encontrado");
    return json(await getPlanWithSteps(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}
