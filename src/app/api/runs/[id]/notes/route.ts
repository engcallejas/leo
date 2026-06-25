import { badRequest, json, notFound, serverError } from "@/lib/api";
import { addRunNote, getRun, listRunNotes } from "@/lib/repo";
import { filesFromForm, saveUploadedImages } from "@/lib/uploads";
import type { AttachedImage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** List steering notes for a run (used by the run UI). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return json(await listRunNotes(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Add a steering note to a run. Accepts JSON ({ text }) or multipart/form-data
 * (text + image "file" fields). Images are saved and delivered to the agent as
 * readable paths at its next checkpoint.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const runId = Number(id);
  const run = await getRun(runId);
  if (!run) return notFound("Run no encontrado");

  let text = "";
  let images: AttachedImage[] = [];
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      text = String(form.get("text") ?? "").trim();
      images = await saveUploadedImages(
        filesFromForm(form),
        `run-${runId}/notes`,
      );
    } else {
      const body = (await req.json()) as { text?: unknown };
      text = String(body.text ?? "").trim();
    }
  } catch (e) {
    return badRequest((e as Error).message || "Cuerpo inválido");
  }

  if (!text && images.length === 0) {
    return badRequest("Falta el texto o una imagen para la nota.");
  }
  try {
    return json(await addRunNote(runId, text, images), 201);
  } catch (e) {
    return serverError(e);
  }
}
