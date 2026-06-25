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
    return json({
      notes: notes.map((n) => {
        if (!n.images.length) return n.text;
        const imgs = n.images
          .map((im) => `- ${im.filename}: ${im.path}`)
          .join("\n");
        return `${n.text}\n\n[Imágenes adjuntas por el humano — léelas con la tool Read usando su ruta absoluta:\n${imgs}]`;
      }),
    });
  } catch (e) {
    return serverError(e);
  }
}
