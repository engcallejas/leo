import { json, notFound, parse, serverError } from "@/lib/api";
import {
  deleteIntegration,
  getIntegration,
  updateIntegration,
  type IntegrationInput,
} from "@/lib/repo";
import { integrationInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const integ = await getIntegration(Number(id));
  return integ ? json(integ) : notFound("Integración no encontrada");
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await parse(req, integrationInputSchema.partial());
  if ("error" in p) return p.error;
  try {
    const updated = await updateIntegration(
      Number(id),
      p.data as Partial<IntegrationInput>,
    );
    return updated ? json(updated) : notFound("Integración no encontrada");
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteIntegration(Number(id));
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
