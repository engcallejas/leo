import { json, serverError } from "@/lib/api";
import { importClickupAttachments } from "@/lib/orchestrator/plan-runner";
import { listAttachments } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const result = await importClickupAttachments(Number(id));
    return json({ ...result, attachments: await listAttachments(Number(id)) });
  } catch (e) {
    return serverError(e);
  }
}
