import { badRequest, json, notFound, serverError } from "@/lib/api";
import { getProvider } from "@/lib/integrations";
import { getIntegration, getTask } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Upload pasted/picked images to a task's source (ClickUp attachments). Lets the
 * board's "Fuentes" lane attach a screenshot/mockup straight onto the source task.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) return notFound("Tarea no encontrada");
  if (task.source_type !== "clickup" || task.integration_id == null) {
    return badRequest(
      "Solo las tareas de ClickUp admiten adjuntar imágenes a la fuente.",
    );
  }
  const integration = await getIntegration(task.integration_id);
  if (!integration) return badRequest("Integración no encontrada");
  const provider = getProvider(integration.type);
  if (!provider.uploadAttachment) {
    return badRequest("La fuente no admite adjuntar archivos.");
  }

  try {
    const form = await req.formData();
    const files = form
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return badRequest("Sin imágenes que subir.");

    const config = integration.config as unknown as Record<string, unknown>;
    const results: { ok: boolean; message: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const buf = Buffer.from(await f.arrayBuffer());
      const name =
        f.name && f.name !== "image.png"
          ? f.name
          : `pegada-${i}.${(f.type.split("/")[1] || "png")}`;
      results.push(
        await provider.uploadAttachment(config, task.external_id, name, buf),
      );
    }
    return json({ ok: results.every((r) => r.ok), results });
  } catch (e) {
    return serverError(e);
  }
}
