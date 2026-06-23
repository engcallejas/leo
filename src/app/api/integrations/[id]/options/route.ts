import { badRequest, json, notFound, serverError } from "@/lib/api";
import { getProvider } from "@/lib/integrations";
import { getIntegration } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Source-builder options for the UI: ClickUp lists or Sentry projects.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const integ = await getIntegration(Number(id));
  if (!integ) return notFound("Integración no encontrada");
  const provider = getProvider(integ.type);
  if (!provider.fetchSourceMeta) {
    return badRequest("La integración no soporta opciones.");
  }
  try {
    const meta = await provider.fetchSourceMeta(
      integ.config as unknown as Record<string, unknown>,
    );
    return json(meta);
  } catch (e) {
    return serverError(e);
  }
}
