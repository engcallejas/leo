import { badRequest, json, serverError } from "@/lib/api";
import { iterateRun, type PrMode } from "@/lib/orchestrator/runner";
import type { AttachedImage } from "@/lib/types";
import { filesFromForm, saveUploadedImages } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Launch the next iteration of a FINISHED run. Accepts JSON or multipart/form-
 * data with fields: instruction, compact ("1"/true), prMode ("commit"|"new_pr"),
 * and image "file" fields. Resumes the run's session by default; with compact it
 * distills the session first and starts fresh.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const runId = Number(id);

  let instruction = "";
  let compact = false;
  let prMode: PrMode = "commit";
  let images: AttachedImage[] = [];
  const ctype = req.headers.get("content-type") || "";

  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      instruction = String(form.get("instruction") ?? "").trim();
      const c = String(form.get("compact") ?? "");
      compact = c === "1" || c === "true";
      if (form.get("prMode") === "new_pr") prMode = "new_pr";
      images = await saveUploadedImages(filesFromForm(form), `run-iter-${runId}`);
    } else {
      const body = (await req.json()) as {
        instruction?: unknown;
        compact?: unknown;
        prMode?: unknown;
      };
      instruction = String(body.instruction ?? "").trim();
      compact = body.compact === true;
      if (body.prMode === "new_pr") prMode = "new_pr";
    }
  } catch (e) {
    return badRequest((e as Error).message || "Cuerpo inválido");
  }

  if (!instruction) return badRequest("Falta la instrucción de la iteración.");
  try {
    const runRow = await iterateRun(runId, instruction, {
      compact,
      prMode,
      images,
    });
    return json(runRow, 201);
  } catch (e) {
    return serverError(e);
  }
}
