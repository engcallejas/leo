import { accountIdFrom, json, parse, serverError } from "@/lib/api";
import { getExecConfig, setExecConfig } from "@/lib/claude-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return json(await getExecConfig(await accountIdFrom(req)));
  } catch (e) {
    return serverError(e);
  }
}

const schema = z.object({
  method: z.enum(["subscription", "api-key"]).optional(),
  defaultModel: z.string().optional(),
  apiKey: z.string().nullable().optional(),
});

export async function PUT(req: Request) {
  const p = await parse(req, schema);
  if ("error" in p) return p.error;
  try {
    return json(await setExecConfig(await accountIdFrom(req), p.data));
  } catch (e) {
    return serverError(e);
  }
}
