import fs from "fs";
import path from "path";
import { badRequest, json, notFound, serverError } from "@/lib/api";
import { UPLOADS_DIR } from "@/lib/db";
import { addAttachment, getPlan, listAttachments } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return json(await listAttachments(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}

/** Upload one or more files (field "file") and attach them to the plan. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const planId = Number(id);
  const plan = await getPlan(planId);
  if (!plan) return notFound("Plan no encontrado");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Se esperaba multipart/form-data");
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return badRequest("No se envió ningún archivo.");

  try {
    const dir = path.join(UPLOADS_DIR, `plan-${planId}`);
    fs.mkdirSync(dir, { recursive: true });
    const saved = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        return badRequest(`"${file.name}" supera 15 MB.`);
      }
      const fname = `${Date.now()}-${safeName(file.name)}`;
      const abs = path.join(dir, fname);
      fs.writeFileSync(abs, buf);
      saved.push(
        await addAttachment({
          plan_id: planId,
          filename: file.name,
          path: abs,
          mime: file.type || "application/octet-stream",
          size: buf.length,
        }),
      );
    }
    return json(saved, 201);
  } catch (e) {
    return serverError(e);
  }
}
