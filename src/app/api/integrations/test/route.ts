import { json, parse } from "@/lib/api";
import { getProvider } from "@/lib/integrations";
import { testConnectionSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const p = await parse(req, testConnectionSchema);
  if ("error" in p) return p.error;
  try {
    const result = await getProvider(p.data.type).testConnection(
      p.data.config as Record<string, unknown>,
    );
    return json(result);
  } catch (e) {
    return json({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
