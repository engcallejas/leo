import { badRequest, json, parse, serverError } from "@/lib/api";
import {
  clearStoredToken,
  getAuthStatus,
  setStoredToken,
} from "@/lib/claude-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenSchema = z.object({ token: z.string().min(10) });

// Save a CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) and re-check auth.
export async function POST(req: Request) {
  const p = await parse(req, tokenSchema);
  if ("error" in p) return p.error;
  const token = p.data.token.trim();
  if (!token) return badRequest("Token vacío");
  try {
    await setStoredToken(token);
    return json(await getAuthStatus(true));
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE() {
  try {
    await clearStoredToken();
    return json(await getAuthStatus(true));
  } catch (e) {
    return serverError(e);
  }
}
