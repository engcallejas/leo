import { randomUUID } from "crypto";
import { json, parse, projectIdFrom, serverError } from "@/lib/api";
import { getProject, listTasks, upsertTask } from "@/lib/repo";
import type { TaskStatus } from "@/lib/types";
import { manualTaskSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scoped to the active project (the view scope). Returns [] when the active
// account has no projects.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as TaskStatus | null;
    const projectId = await projectIdFrom(req);
    if (projectId == null) return json([]);
    const tasks = await listTasks({
      status: status ?? undefined,
      project_id: projectId,
      limit: 300,
    });
    return json(tasks);
  } catch (e) {
    return serverError(e);
  }
}

/** Create a manual task (no integration) for a project. */
export async function POST(req: Request) {
  const p = await parse(req, manualTaskSchema);
  if ("error" in p) return p.error;
  try {
    const project = await getProject(p.data.project_id);
    if (!project) return serverError(new Error("Proyecto no encontrado"));
    const task = await upsertTask({
      project_id: p.data.project_id,
      integration_id: null,
      source_type: "manual",
      external_id: `manual-${randomUUID()}`,
      title: p.data.title,
      description: p.data.description ?? "",
      url: p.data.url ?? null,
      status: "pending",
    });
    return json(task, 201);
  } catch (e) {
    return serverError(e);
  }
}
