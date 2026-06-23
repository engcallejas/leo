import { json, notFound } from "@/lib/api";
import { stopRun } from "@/lib/orchestrator/runner";
import { getRun, setTaskStatus, updateRun } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const runId = Number(id);
  const run = await getRun(runId);
  if (!run) return notFound("Run no encontrado");
  const killed = stopRun(runId);
  if (run.status === "running") {
    await updateRun(runId, {
      status: "cancelled",
      error: "Detenido por el usuario",
      finished: true,
    });
    await setTaskStatus(run.task_id, "cancelled");
  }
  return json({ ok: true, killed });
}
