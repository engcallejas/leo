import { z } from "zod";
import { json, notFound, parse, serverError } from "@/lib/api";
import {
  getAccount,
  getActiveAccountId,
  setActiveAccountId,
} from "@/lib/account-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ activeId: await getActiveAccountId() });
  } catch (e) {
    return serverError(e);
  }
}

const schema = z.object({ id: z.number().int().positive() });

export async function PUT(req: Request) {
  const p = await parse(req, schema);
  if ("error" in p) return p.error;
  try {
    const account = await getAccount(p.data.id);
    if (!account) return notFound("Cuenta no encontrada");
    await setActiveAccountId(p.data.id);
    return json({ activeId: p.data.id });
  } catch (e) {
    return serverError(e);
  }
}
