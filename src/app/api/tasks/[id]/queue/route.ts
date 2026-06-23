import { json, notFound, serverError } from "@/lib/api";
import { getTask, queueTask } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Mark a task queued (runs sequentially when a slot frees). Optional
// scheduled_for (ISO) defers it until that time.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) return notFound("Tarea no encontrada");

  let scheduledFor: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body.scheduled_for === "string" && body.scheduled_for) {
      scheduledFor = body.scheduled_for;
    }
  } catch {
    /* empty body = queue now */
  }

  try {
    await queueTask(Number(id), scheduledFor);
    return json(await getTask(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}
