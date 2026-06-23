import { json, serverError } from "@/lib/api";
import { listModels } from "@/lib/claude-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await listModels());
  } catch (e) {
    return serverError(e);
  }
}
