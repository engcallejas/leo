import path from "path";
import { json, notFound, serverError } from "@/lib/api";
import { getProject } from "@/lib/repo";
import { collectSpecFiles } from "@/lib/specs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** List the requirement docs (spec globs) found in a project's repo. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = await getProject(Number(id));
  if (!project) return notFound("Proyecto no encontrado");
  try {
    const files = collectSpecFiles(project).map((f) => ({
      path: f.path,
      abs: path.join(project.repo_path, f.path),
      size: f.content.length,
    }));
    return json({ repo_path: project.repo_path, files });
  } catch (e) {
    return serverError(e);
  }
}
