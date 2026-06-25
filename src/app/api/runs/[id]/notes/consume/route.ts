import { json, serverError } from "@/lib/api";
import { consumePendingRunNotes } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Return undelivered steering notes for a run and mark them delivered. Called by
 * the Leo MCP `check_in` tool from inside a running agent at its checkpoints.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const notes = await consumePendingRunNotes(Number(id));
    return json({ notes: notes.map((n) => n.text) });
  } catch (e) {
    return serverError(e);
  }
}
