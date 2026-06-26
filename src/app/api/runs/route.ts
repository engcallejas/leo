import { json, projectIdFrom, serverError } from "@/lib/api";
import { listRuns } from "@/lib/repo";
import type { RunStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scoped to the active project (the view scope), unless an explicit task_id is
// given (run detail / lineage). Returns [] when the account has no projects.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as RunStatus | null;
    const taskId = url.searchParams.get("task_id");
    if (taskId) {
      return json(
        await listRuns({
          status: status ?? undefined,
          task_id: Number(taskId),
          limit: 100,
        }),
      );
    }
    const projectId = await projectIdFrom(req);
    if (projectId == null) return json([]);
    return json(
      await listRuns({
        status: status ?? undefined,
        project_id: projectId,
        limit: 100,
      }),
    );
  } catch (e) {
    return serverError(e);
  }
}
