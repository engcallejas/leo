import fs from "fs";
import path from "path";
import type { Project } from "./types";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".vercel",
  "coverage",
  "vendor",
  ".turbo",
]);

const MAX_FILES = 40;
const MAX_TOTAL = 60_000;
const PER_FILE = 8_000;

function parseGlobs(spec: string): string[] {
  return spec
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Minimal glob → RegExp (supports **, *, ?). Paths are repo-relative, '/'-sep. */
function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const out = esc
    .replace(/\*\*\/?/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/§§/g, ".*");
  return new RegExp("^" + out + "$");
}

export interface SpecFile {
  path: string; // repo-relative
  content: string;
}

/** Walk the repo and collect files matching any of the project's spec globs. */
export function collectSpecFiles(project: Project): SpecFile[] {
  const globs = parseGlobs(project.spec_globs || "");
  if (globs.length === 0) return [];
  const root = project.repo_path;
  if (!root || !fs.existsSync(root)) return [];
  const regexes = globs.map(globToRegExp);

  const out: SpecFile[] = [];
  let total = 0;

  const walk = (dir: string) => {
    if (out.length >= MAX_FILES || total >= MAX_TOTAL) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES || total >= MAX_TOTAL) return;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(abs);
      } else if (e.isFile()) {
        if (!regexes.some((re) => re.test(rel))) continue;
        try {
          const raw = fs.readFileSync(abs, "utf8");
          const content =
            raw.length > PER_FILE ? raw.slice(0, PER_FILE) + "\n…[truncado]" : raw;
          out.push({ path: rel, content });
          total += content.length;
        } catch {
          /* skip unreadable */
        }
      }
    }
  };
  walk(root);
  return out;
}

/** A prompt-ready markdown block with the requirement docs (or "" if none). */
export function buildSpecContext(project: Project, full = true): string {
  const files = collectSpecFiles(project);
  if (files.length === 0) return "";
  const header = `## Documentos de requerimientos (SDD/AIDLC)\nEste proyecto define su especificación en estos archivos. Respétalos como fuente de verdad del requerimiento:`;
  if (!full) {
    return `${header}\n${files.map((f) => `- ${f.path}`).join("\n")}`;
  }
  const blocks = files.map(
    (f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``,
  );
  return `${header}\n\n${blocks.join("\n\n")}`;
}
