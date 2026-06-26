import { accountIdFrom, json } from "@/lib/api";
import { testApiKey } from "@/lib/claude-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let key: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.apiKey === "string") key = body.apiKey;
  } catch {
    /* use stored key */
  }
  return json(await testApiKey(await accountIdFrom(req), key));
}
