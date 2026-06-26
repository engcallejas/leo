import { z } from "zod";
import { json, parse, serverError } from "@/lib/api";
import {
  createAccount,
  getActiveAccountId,
  listAccounts,
  setActiveAccountId,
} from "@/lib/account-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [accounts, activeId] = await Promise.all([
      listAccounts(),
      getActiveAccountId(),
    ]);
    return json({ accounts, activeId });
  } catch (e) {
    return serverError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  /** When true, switch the active account to the newly created one. */
  activate: z.boolean().optional(),
});

export async function POST(req: Request) {
  const p = await parse(req, createSchema);
  if ("error" in p) return p.error;
  try {
    const account = await createAccount(p.data.name, p.data.color);
    if (p.data.activate !== false) await setActiveAccountId(account.id);
    return json(account, 201);
  } catch (e) {
    return serverError(e);
  }
}
