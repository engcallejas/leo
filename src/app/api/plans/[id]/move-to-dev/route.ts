import { json, serverError } from "@/lib/api";
import { movePlanToDevStatus } from "@/lib/orchestrator/plan-runner";
import { getPlanWithSteps } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const result = await movePlanToDevStatus(Number(id));
    return json({ ...result, plan: await getPlanWithSteps(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
