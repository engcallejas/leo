import { badRequest, json, notFound, serverError } from "@/lib/api";
import { addRunNote, getRun, listRunNotes } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** List steering notes for a run (used by the run UI). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return json(await listRunNotes(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}

/** Add a steering note to a run (the agent pulls it at its next checkpoint). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const runId = Number(id);
  const run = await getRun(runId);
  if (!run) return notFound("Run no encontrado");
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }
  const text = String(body.text ?? "").trim();
  if (!text) return badRequest("Falta el texto de la nota.");
  try {
    return json(await addRunNote(runId, text), 201);
  } catch (e) {
    return serverError(e);
  }
}
