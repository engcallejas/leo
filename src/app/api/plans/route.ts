import { json, projectIdFrom, serverError } from "@/lib/api";
import { listPlans } from "@/lib/plan-repo";
import type { PlanStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scoped to the active project (the view scope). Returns [] when the active
// account has no projects.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as PlanStatus | null;
    const projectId = await projectIdFrom(req);
    if (projectId == null) return json([]);
    const plans = await listPlans({
      project_id: projectId,
      status: status ?? undefined,
      limit: 300,
    });
    return json(plans);
  } catch (e) {
    return serverError(e);
  }
}
