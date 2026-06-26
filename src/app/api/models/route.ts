import { accountIdFrom, json, serverError } from "@/lib/api";
import { listModels } from "@/lib/claude-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return json(await listModels(await accountIdFrom(req)));
  } catch (e) {
    return serverError(e);
  }
}
