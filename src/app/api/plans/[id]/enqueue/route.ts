import { json, notFound, parse, serverError } from "@/lib/api";
import { enqueuePlan } from "@/lib/orchestrator/plan-runner";
import { getPlanWithSteps } from "@/lib/plan-repo";
import { planEnqueueSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await parse(req, planEnqueueSchema);
  if ("error" in p) return p.error;
  try {
    const plan = await enqueuePlan(
      Number(id),
      p.data.scheduled_for && p.data.scheduled_for.trim()
        ? p.data.scheduled_for
        : null,
    );
    if (!plan) return notFound("Plan no encontrado");
    return json(await getPlanWithSteps(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}
