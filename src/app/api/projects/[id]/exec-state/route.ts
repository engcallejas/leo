import fs from "fs";
import { json, notFound, serverError } from "@/lib/api";
import { isGitRepo } from "@/lib/orchestrator/worktree";
import { getProject, listRuns } from "@/lib/repo";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lightweight preflight for the launch guard: is a run already in flight on this
 * project's repo (so a new run should offer worktree isolation), and how many
 * concurrent runs does the account allow (>1 → default to worktree).
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const project = await getProject(Number(id));
    if (!project) return notFound("Proyecto no encontrado");
    const running = await listRuns({
      status: "running",
      project_id: project.id,
      limit: 1,
    });
    const settings = await getSettings(project.account_id);
    // Worktrees need a git repo; if it isn't one, don't offer that option.
    const git = fs.existsSync(project.repo_path) && isGitRepo(project.repo_path);
    return json({
      busy: running.length > 0,
      running_run_id: running[0]?.id ?? null,
      max_concurrent: settings.max_concurrent_runs,
      git,
    });
  } catch (e) {
    return serverError(e);
  }
}
