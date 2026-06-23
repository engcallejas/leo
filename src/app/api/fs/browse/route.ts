import fs from "fs";
import os from "os";
import path from "path";
import { json, serverError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Entry {
  name: string;
  path: string;
  isRepo: boolean;
}

// Browse the server's filesystem (local-only tool). Lists subdirectories so the
// UI can pick a repo folder instead of typing the path.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("path");
    const home = os.homedir();
    let dir = requested ? path.resolve(requested) : home;

    // Fall back to home if the path is gone/unreadable.
    if (!fs.existsSync(dir)) dir = home;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) dir = path.dirname(dir);

    let entries: Entry[] = [];
    let error: string | null = null;
    try {
      const dirents = fs.readdirSync(dir, { withFileTypes: true });
      entries = dirents
        .filter((d) => {
          if (d.isDirectory()) return true;
          if (d.isSymbolicLink()) {
            try {
              return fs.statSync(path.join(dir, d.name)).isDirectory();
            } catch {
              return false;
            }
          }
          return false;
        })
        .map((d) => {
          const full = path.join(dir, d.name);
          let isRepo = false;
          try {
            isRepo = fs.existsSync(path.join(full, ".git"));
          } catch {
            /* ignore */
          }
          return { name: d.name, path: full, isRepo };
        })
        .sort((a, b) => {
          // non-hidden first, then alphabetical
          const ah = a.name.startsWith(".");
          const bh = b.name.startsWith(".");
          if (ah !== bh) return ah ? 1 : -1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 2000);
    } catch (e) {
      error = `No se puede leer este directorio: ${(e as Error).message}`;
    }

    const parent = path.dirname(dir);
    const roots = ["/repos", home, "/"].filter(
      (r, i, arr) => fs.existsSync(r) && arr.indexOf(r) === i,
    );

    return json({
      path: dir,
      parent: parent === dir ? null : parent,
      isRepo: fs.existsSync(path.join(dir, ".git")),
      entries,
      roots,
      home,
      error,
    });
  } catch (e) {
    return serverError(e);
  }
}
