import { accountIdFrom, json, parse, serverError } from "@/lib/api";
import {
  createIntegration,
  listIntegrations,
  type IntegrationInput,
} from "@/lib/repo";
import { integrationInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return json(await listIntegrations(await accountIdFrom(req)));
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request) {
  const p = await parse(req, integrationInputSchema);
  if ("error" in p) return p.error;
  try {
    const account_id = await accountIdFrom(req);
    return json(
      await createIntegration({ ...p.data, account_id } as IntegrationInput),
      201,
    );
  } catch (e) {
    return serverError(e);
  }
}
