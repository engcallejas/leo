import { z } from "zod";
import { badRequest, json, notFound, parse, serverError } from "@/lib/api";
import {
  deleteAccount,
  getAccount,
  updateAccount,
} from "@/lib/account-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const account = await getAccount(Number(id));
    return account ? json(account) : notFound();
  } catch (e) {
    return serverError(e);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await parse(req, patchSchema);
  if ("error" in p) return p.error;
  try {
    const { id } = await params;
    const updated = await updateAccount(Number(id), p.data);
    return updated ? json(updated) : notFound();
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ok = await deleteAccount(Number(id));
    if (!ok) {
      return badRequest("No se puede eliminar la última cuenta.");
    }
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
