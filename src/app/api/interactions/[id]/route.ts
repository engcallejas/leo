import { json, notFound, serverError } from "@/lib/api";
import { getInteraction } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Poll a single interaction (used by the Leo MCP server to await an answer). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const it = await getInteraction(Number(id));
  if (!it) return notFound("Interacción no encontrada");
  try {
    return json(it);
  } catch (e) {
    return serverError(e);
  }
}
