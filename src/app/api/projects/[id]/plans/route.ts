import { badRequest, json, notFound, parse, serverError } from "@/lib/api";
import { createPlan, listPlans } from "@/lib/plan-repo";
import { getProject, getTask } from "@/lib/repo";
import { planCreateSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const plans = await listPlans({ project_id: Number(id), limit: 300 });
    return json(plans);
  } catch (e) {
    return serverError(e);
  }
}

/** Create a plan for a project, seeded from a pulled task or from manual fields. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const projectId = Number(id);
  const project = await getProject(projectId);
  if (!project) return notFound("Proyecto no encontrado");

  const p = await parse(req, planCreateSchema);
  if ("error" in p) return p.error;
  const body = p.data;

  try {
    if (body.from_task_id) {
      const task = await getTask(body.from_task_id);
      if (!task) return notFound("Tarea origen no encontrada");
      const plan = await createPlan({
        project_id: projectId,
        title: task.title,
        objective: task.description,
        source_type: task.source_type,
        source_integration_id: task.integration_id,
        source_external_id: task.external_id,
        source_url: task.url,
      });
      return json(plan, 201);
    }

    if (!body.title || !body.title.trim()) {
      return badRequest("Falta el título del plan (o un from_task_id).");
    }
    const plan = await createPlan({
      project_id: projectId,
      title: body.title.trim(),
      objective: body.objective ?? "",
      source_type: body.source_type ?? "manual",
      source_integration_id: body.source_integration_id ?? null,
      source_external_id: body.source_external_id ?? null,
      source_url: body.source_url ?? null,
    });
    return json(plan, 201);
  } catch (e) {
    return serverError(e);
  }
}
