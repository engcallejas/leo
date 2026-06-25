import { badRequest, json, notFound, serverError } from "@/lib/api";
import { answerInteraction, getInteraction } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Answer an interaction from the run UI; unblocks the waiting MCP tool. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const it = await getInteraction(Number(id));
  if (!it) return notFound("Interacción no encontrada");
  if (it.status !== "pending")
    return badRequest("Esta interacción ya fue respondida o cancelada.");
  let body: { answer?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }
  const answer = String(body.answer ?? "").trim();
  if (!answer) return badRequest("Falta la respuesta.");
  try {
    const updated = await answerInteraction(Number(id), answer);
    return json(updated);
  } catch (e) {
    return serverError(e);
  }
}
