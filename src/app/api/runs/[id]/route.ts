import { json, notFound } from "@/lib/api";
import { getRun, getTask } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const run = await getRun(Number(id));
  if (!run) return notFound("Run no encontrado");
  const task = await getTask(run.task_id);
  return json({ run, task });
}
