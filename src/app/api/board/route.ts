import { json, serverError } from "@/lib/api";
import { assembleBoard } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The unified Kanban board: all cards (plans + loose tasks), unfiltered. */
export async function GET() {
  try {
    return json(await assembleBoard());
  } catch (e) {
    return serverError(e);
  }
}
