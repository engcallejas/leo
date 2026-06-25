import fs from "fs";
import { notFound } from "@/lib/api";
import { getAttachment } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attId: string }> };

/** Serve the attachment bytes (for thumbnails/preview in the UI). */
export async function GET(_req: Request, { params }: Ctx) {
  const { attId } = await params;
  const att = await getAttachment(Number(attId));
  if (!att) return notFound("Adjunto no encontrado");
  if (!fs.existsSync(att.path)) return notFound("Archivo no encontrado");
  const buf = fs.readFileSync(att.path);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": att.mime || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
