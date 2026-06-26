import { z } from "zod";
import { json, notFound, parse, serverError } from "@/lib/api";
import { getActiveAccountId, getActiveProjectId, setActiveProjectId } from "@/lib/account-repo";
import { getProject } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ activeProjectId: await getActiveProjectId() });
  } catch (e) {
    return serverError(e);
  }
}

const schema = z.object({ id: z.number().int().positive() });

// Switch the active project (the view scope). The project must belong to the
// active account.
export async function PUT(req: Request) {
  const p = await parse(req, schema);
  if ("error" in p) return p.error;
  try {
    const project = await getProject(p.data.id);
    const accountId = await getActiveAccountId();
    if (!project || project.account_id !== accountId) {
      return notFound("Proyecto no encontrado en la cuenta activa");
    }
    await setActiveProjectId(p.data.id);
    return json({ activeProjectId: p.data.id });
  } catch (e) {
    return serverError(e);
  }
}
