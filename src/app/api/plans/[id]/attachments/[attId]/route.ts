import fs from "fs";
import { json, notFound, serverError } from "@/lib/api";
import { deleteAttachment, getAttachment } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { attId } = await params;
  const att = await getAttachment(Number(attId));
  if (!att) return notFound("Adjunto no encontrado");
  try {
    fs.rmSync(att.path, { force: true });
  } catch {
    /* ignore missing file */
  }
  try {
    await deleteAttachment(att.id);
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
