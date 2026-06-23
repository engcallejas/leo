import { json, notFound, parse, serverError } from "@/lib/api";
import { addStep, getPlan } from "@/lib/plan-repo";
import { planStepInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const plan = await getPlan(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  const p = await parse(req, planStepInputSchema);
  if ("error" in p) return p.error;
  try {
    const step = await addStep(Number(id), {
      title: p.data.title,
      spec: p.data.spec ?? "",
    });
    return json(step, 201);
  } catch (e) {
    return serverError(e);
  }
}
