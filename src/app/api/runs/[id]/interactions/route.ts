import { badRequest, json, notFound, serverError } from "@/lib/api";
import { createInteraction, getRun, listInteractions } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** List interactions for a run (used by the run UI). */
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
      run_id: Number(id),
      status: status ?? undefined,
      limit: 100,
    });
    return json(items);
  } catch (e) {
    return serverError(e);
  }
}

/** Create an interaction (called by the Leo MCP server during a run). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const run = await getRun(Number(id));
  if (!run) return notFound("Run no encontrado");
  let body: { kind?: string; question?: string; options?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }
  if (!body.question) return badRequest("Falta question");
  try {
    const it = await createInteraction({
      run_id: run.id,
      task_id: run.task_id,
      kind: body.kind === "approval" ? "approval" : "question",
      question: String(body.question),
      options: Array.isArray(body.options) ? body.options.map(String) : [],
    });
    return json({ id: it.id }, 201);
  } catch (e) {
    return serverError(e);
  }
}
