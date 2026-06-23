import { json } from "@/lib/api";
import { boot } from "@/lib/boot";
import { countByStatus } from "@/lib/repo";
import { schedulerStatus } from "@/lib/orchestrator/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // This endpoint is the heartbeat polled by the sidebar on every page, so it
  // is the reliable place to start the scheduler in production (the root layout
  // is statically rendered and never re-runs at runtime).
  await boot();
  const counts = await countByStatus();
  return json({ scheduler: schedulerStatus(), counts });
}
