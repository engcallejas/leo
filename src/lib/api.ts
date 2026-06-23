import type { ZodType } from "zod";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
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
