import { json, notFound, serverError } from "@/lib/api";
import { run as dbRun } from "@/lib/db";
import { getTask } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  return task ? json(task) : notFound("Tarea no encontrada");
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await dbRun("DELETE FROM tasks WHERE id = ?", [Number(id)]);
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
