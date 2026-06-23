import { json, serverError } from "@/lib/api";
import { startRefinement } from "@/lib/orchestrator/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const plan = await startRefinement(Number(id));
    return json(plan);
  } catch (e) {
    return serverError(e);
  }
}
