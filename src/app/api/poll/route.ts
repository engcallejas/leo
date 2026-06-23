import { json, serverError } from "@/lib/api";
import { boot } from "@/lib/boot";
import { pollNow } from "@/lib/orchestrator/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await boot();
    return json(await pollNow());
  } catch (e) {
    return serverError(e);
  }
}
