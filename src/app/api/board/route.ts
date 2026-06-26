import { json, projectIdFrom, serverError } from "@/lib/api";
import { assembleBoard } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The unified Kanban board for the active (or requested) project's cards. */
export async function GET(req: Request) {
  try {
    const projectId = await projectIdFrom(req);
    if (projectId == null) return json([]);
    return json(await assembleBoard({ projectId }));
  } catch (e) {
    return serverError(e);
  }
}
