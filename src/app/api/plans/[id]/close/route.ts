import { json, notFound, serverError } from "@/lib/api";
import { getPlan, getPlanWithSteps, setPlanClosed } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Close (archive) or reopen a plan card. Body: { closed?: boolean } (default close). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const plan = await getPlan(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  let closed = true;
  try {
    const body = (await req.json()) as { closed?: boolean };
    if (body && body.closed === false) closed = false;
  } catch {
    /* no body → close */
  }
  try {
    await setPlanClosed(Number(id), closed);
    return json({ ok: true, plan: await getPlanWithSteps(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
