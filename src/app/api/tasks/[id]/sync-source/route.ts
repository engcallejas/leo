import { badRequest, json, notFound, serverError } from "@/lib/api";
import { getProvider } from "@/lib/integrations";
import { getIntegration, getTask, updateTaskFields } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Board "Fuentes" lane: edit a task's business fields (title/description/status)
 * locally and, when the source supports it (ClickUp), push the change back.
 * Manual tasks are local-only; Sentry is read-only (no updateTask).
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) return notFound("Tarea no encontrada");

  let body: {
    title?: string;
    description?: string;
    status?: string;
    sync?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido en el body");
  }

  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const description =
    typeof body.description === "string" ? body.description : undefined;
  const status =
    typeof body.status === "string" && body.status ? body.status : undefined;
  const sync = body.sync !== false; // default: also push to the source

  try {
    // 1) Persist local edits (polling never overwrites title/description).
    if (title !== undefined || description !== undefined) {
      await updateTaskFields(Number(id), {
        title: title !== undefined ? title || task.title : undefined,
        description,
      });
    }

    // 2) Push to the source where supported.
    let synced: { ok: boolean; message: string } | null = null;
    if (sync && task.source_type !== "manual" && task.integration_id != null) {
      const integration = await getIntegration(task.integration_id);
      if (integration) {
        const provider = getProvider(integration.type);
        if (provider.updateTask) {
          synced = await provider.updateTask(
            integration.config as unknown as Record<string, unknown>,
            task.external_id,
            { name: title, description, status },
          );
        } else {
          synced = {
            ok: false,
            message: `La fuente ${integration.type} no permite editar tareas.`,
          };
        }
      }
    }

    return json({ ok: true, task: await getTask(Number(id)), synced });
  } catch (e) {
    return serverError(e);
  }
}
