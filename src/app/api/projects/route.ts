import { accountIdFrom, json, parse, serverError } from "@/lib/api";
import { createProject, listProjects, type ProjectInput } from "@/lib/repo";
import { projectInputSchema } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return json(await listProjects(await accountIdFrom(req)));
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: Request) {
  const p = await parse(req, projectInputSchema);
  if ("error" in p) return p.error;
  try {
    const account_id = await accountIdFrom(req);
    return json(
      await createProject({ ...p.data, account_id } as ProjectInput),
      201,
    );
  } catch (e) {
    return serverError(e);
  }
}
