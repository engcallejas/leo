import type { ZodType } from "zod";
import { getActiveAccountId, getActiveProjectId } from "./account-repo";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * Resolve which account a request is scoped to: the explicit `?account_id=`
 * query param when present (the UI passes the active account), otherwise the
 * install-wide active-account pointer. Mutations create rows under this id.
 */
export async function accountIdFrom(req: Request): Promise<number> {
  const raw = new URL(req.url).searchParams.get("account_id");
  const n = raw != null ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return getActiveAccountId();
}

/**
 * Resolve which project a *view* request is scoped to: the explicit
 * `?project_id=` query param when present, otherwise the active-project pointer.
 * Returns null when the active account has no projects — callers should then
 * return an empty result.
 */
export async function projectIdFrom(req: Request): Promise<number | null> {
  const raw = new URL(req.url).searchParams.get("project_id");
  const n = raw != null ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return getActiveProjectId();
}

export function badRequest(message: string, details?: unknown): Response {
  return Response.json({ error: message, details }, { status: 400 });
}

export function notFound(message = "No encontrado"): Response {
  return Response.json({ error: message }, { status: 404 });
}

export function serverError(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  return Response.json({ error: message }, { status: 500 });
}

export async function parse<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: badRequest("JSON inválido en el body") };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      error: badRequest("Validación fallida", result.error.flatten()),
    };
  }
  return { data: result.data };
}
