import { badRequest, json, notFound, serverError } from "@/lib/api";
import { getProvider } from "@/lib/integrations";
import { getIntegration } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// ClickUp: statuses available in a list (for the status multi-select).
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const listId = new URL(req.url).searchParams.get("listId");
  if (!listId) return badRequest("Falta listId");
  const integ = await getIntegration(Number(id));
  if (!integ) return notFound("Integración no encontrada");
  const provider = getProvider(integ.type);
  if (!provider.fetchListStatuses) return json([]);
  try {
    const statuses = await provider.fetchListStatuses(
      integ.config as unknown as Record<string, unknown>,
      listId,
    );
    return json(statuses);
  } catch (e) {
    return serverError(e);
  }
}
