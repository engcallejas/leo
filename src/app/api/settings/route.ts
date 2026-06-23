import { json, parse, serverError } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(await getSettings());
  } catch (e) {
    return serverError(e);
  }
}

export async function PUT(req: Request) {
  const p = await parse(req, settingsSchema);
  if ("error" in p) return p.error;
  try {
    return json(await updateSettings(p.data));
  } catch (e) {
    return serverError(e);
  }
}
