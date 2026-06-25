import fs from "fs";
import path from "path";
import { UPLOADS_DIR } from "./db";
import type { AttachedImage } from "./types";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per file

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

/**
 * Persist uploaded files under UPLOADS_DIR/<subdir>/ and return readable refs.
 * Dev runs get `--add-dir UPLOADS_DIR`, so the agent can Read these by path.
 * Throws on a file over the size limit.
 */
export async function saveUploadedImages(
  files: File[],
  subdir: string,
): Promise<AttachedImage[]> {
  if (!files.length) return [];
  const dir = path.join(UPLOADS_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const out: AttachedImage[] = [];
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`"${file.name}" supera 15 MB.`);
    const abs = path.join(dir, `${Date.now()}-${safeName(file.name)}`);
    fs.writeFileSync(abs, buf);
    out.push({
      filename: file.name,
      path: abs,
      mime: file.type || "application/octet-stream",
    });
  }
  return out;
}

/** Pull all File entries from a multipart form's "file" field. */
export function filesFromForm(form: FormData): File[] {
  return form.getAll("file").filter((f): f is File => f instanceof File);
}
