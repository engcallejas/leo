import { json, notFound, serverError } from "@/lib/api";
import { getTask, setTaskClosed } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Close (archive) or reopen a task card. Body: { closed?: boolean } (default close). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const task = await getTask(Number(id));
  if (!task) return notFound("Tarea no encontrada");
  let closed = true;
  try {
    const body = (await req.json()) as { closed?: boolean };
    if (body && body.closed === false) closed = false;
  } catch {
    /* no body → close */
  }
  try {
    await setTaskClosed(Number(id), closed);
    return json({ ok: true, task: await getTask(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
