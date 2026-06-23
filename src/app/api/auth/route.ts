import { json, serverError } from "@/lib/api";
import { getAuthStatus } from "@/lib/claude-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "true";
    return json(await getAuthStatus(force));
  } catch (e) {
    return serverError(e);
  }
}
