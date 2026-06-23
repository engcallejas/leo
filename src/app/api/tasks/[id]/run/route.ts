import { json, serverError } from "@/lib/api";
import { startTaskRun } from "@/lib/orchestrator/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const result = await startTaskRun(Number(id));
    return json(result);
  } catch (e) {
    return serverError(e);
  }
}
