import { json, serverError } from "@/lib/api";
import { startTaskRun } from "@/lib/orchestrator/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    // Optional body: { worktree: true } runs it in an isolated worktree so it can
    // execute in parallel with a run already in flight on the same repo.
    const body = await req.json().catch(() => ({}));
    const worktree = (body as { worktree?: unknown })?.worktree === true;
    const result = await startTaskRun(Number(id), { worktree });
    return json(result);
  } catch (e) {
    return serverError(e);
  }
}
