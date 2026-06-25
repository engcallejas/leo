import { badRequest, json, notFound, serverError } from "@/lib/api";
import { getPlan } from "@/lib/plan-repo";
import { createInteraction, listInteractions } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** List interactions raised during a plan's refinement (used by the plan UI). */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as
      | "pending"
      | "answered"
      | "cancelled"
      | null;
    const items = await listInteractions({
      plan_id: Number(id),
      status: status ?? undefined,
      limit: 100,
    });
    return json(items);
  } catch (e) {
    return serverError(e);
  }
}

/** Create a refinement interaction (called by the Leo MCP server). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const plan = await getPlan(Number(id));
  if (!plan) return notFound("Plan no encontrado");
  let body: { kind?: string; question?: string; options?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }
  if (!body.question) return badRequest("Falta question");
  try {
    const it = await createInteraction({
      plan_id: plan.id,
      task_id: null,
      kind: body.kind === "approval" ? "approval" : "question",
      question: String(body.question),
      options: Array.isArray(body.options) ? body.options.map(String) : [],
    });
    return json({ id: it.id }, 201);
  } catch (e) {
    return serverError(e);
  }
}
