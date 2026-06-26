import { badRequest, json, notFound, serverError } from "@/lib/api";
import { getTask, setTaskClosed, setTaskStatus } from "@/lib/repo";
import type { TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const TASK_STATUSES: TaskStatus[] = [
  "pending",
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
  "cancelled",
];

/**
 * Manual board override: force a task into any state (status and/or closed flag).
 * Used by the board's free drag-between-columns. Body: { status?, closed? }.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) return notFound("Tarea no encontrada");
  let body: { status?: string; closed?: boolean };
  try {
    body = await req.json();
  } catch {
    return badRequest("JSON inválido en el body");
  }
  try {
    if (body.status) {
      if (!TASK_STATUSES.includes(body.status as TaskStatus)) {
        return badRequest(`Estado inválido: ${body.status}`);
      }
      await setTaskStatus(Number(id), body.status as TaskStatus);
    }
    if (typeof body.closed === "boolean") {
      await setTaskClosed(Number(id), body.closed);
    }
    return json({ ok: true, task: await getTask(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
