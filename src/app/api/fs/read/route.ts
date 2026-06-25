import fs from "fs";
import path from "path";
import { badRequest, json, serverError } from "@/lib/api";
import { listProjects } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 400_000;

/**
 * Read a single file's text content. Guarded: the path must live inside one of
 * the configured projects' repos (local-only tool, but avoid arbitrary reads).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("path");
    if (!requested) return badRequest("Falta el parámetro path");
    const abs = path.resolve(requested);

    const projects = await listProjects();
    const allowed = projects.some((p) => {
      const root = path.resolve(p.repo_path);
      return abs === root || abs.startsWith(root + path.sep);
    });
    if (!allowed) {
      return badRequest("Ruta fuera de los repos de los proyectos.");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return badRequest("No es un archivo válido.");
    }
    const stat = fs.statSync(abs);
    const fd = fs.openSync(abs, "r");
    const len = Math.min(stat.size, MAX_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    const content =
      stat.size > MAX_BYTES
        ? buf.toString("utf8") + "\n…[truncado]"
        : buf.toString("utf8");
    return json({ path: abs, content, truncated: stat.size > MAX_BYTES });
  } catch (e) {
    return serverError(e);
  }
}
