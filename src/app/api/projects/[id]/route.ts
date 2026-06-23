import { json, notFound, parse, serverError } from "@/lib/api";
import {
  deleteProject,
  getProject,
  updateProject,
  type ProjectInput,
} from "@/lib/repo";
import { projectInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = await getProject(Number(id));
  return project ? json(project) : notFound("Proyecto no encontrado");
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await parse(req, projectInputSchema.partial());
  if ("error" in p) return p.error;
  try {
    const updated = await updateProject(
      Number(id),
      p.data as Partial<ProjectInput>,
    );
    return updated ? json(updated) : notFound("Proyecto no encontrado");
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteProject(Number(id));
    return json({ ok: true });
  } catch (e) {
    return serverError(e);
  }
}
