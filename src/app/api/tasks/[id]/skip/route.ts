import { json, notFound, serverError } from "@/lib/api";
import { getTask, setTaskStatus } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Discard a task: mark it 'skipped' so it leaves the queue and is NOT re-pulled
// (polling upserts preserve the status). Reversible by re-running it.
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) return notFound("Tarea no encontrada");
  if (task.status === "running") {
    return json({ ok: false, reason: "La tarea está corriendo." }, 409);
  }
  try {
    await setTaskStatus(Number(id), "skipped");
    return json(await getTask(Number(id)));
  } catch (e) {
    return serverError(e);
  }
}
