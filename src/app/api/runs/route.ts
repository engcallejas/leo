import { json, serverError } from "@/lib/api";
import { listRuns } from "@/lib/repo";
import type { RunStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as RunStatus | null;
    const projectId = url.searchParams.get("project_id");
    const taskId = url.searchParams.get("task_id");
    return json(
      await listRuns({
        status: status ?? undefined,
        project_id: projectId ? Number(projectId) : undefined,
        task_id: taskId ? Number(taskId) : undefined,
        limit: 100,
      }),
    );
  } catch (e) {
    return serverError(e);
  }
}
