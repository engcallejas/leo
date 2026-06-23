import { json, serverError } from "@/lib/api";
import { listPlans } from "@/lib/plan-repo";
import type { PlanStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("project_id");
    const status = url.searchParams.get("status") as PlanStatus | null;
    const plans = await listPlans({
      project_id: projectId ? Number(projectId) : undefined,
      status: status ?? undefined,
      limit: 300,
    });
    return json(plans);
  } catch (e) {
    return serverError(e);
  }
}
