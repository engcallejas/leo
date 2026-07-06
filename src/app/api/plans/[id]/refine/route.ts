import { json, serverError } from "@/lib/api";
import { startRefinement } from "@/lib/orchestrator/planner";
import { addPlanComment } from "@/lib/plan-repo";
import { planRefineSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const planId = Number(id);
  try {
    // Body is optional: a bare refine has no feedback (from-scratch / retry).
    const raw = await req.json().catch(() => ({}));
    const parsed = planRefineSchema.safeParse(raw ?? {});
    const feedback = parsed.success ? parsed.data.feedback?.trim() : "";

    // Record the feedback as a comment thread entry before kicking off the
    // iteration, so the user always sees what they asked even if the run fails.
    if (feedback) await addPlanComment(planId, feedback);

    const plan = await startRefinement(planId, { feedback });
    return json(plan);
  } catch (e) {
    return serverError(e);
  }
}
