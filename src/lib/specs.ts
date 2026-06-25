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

export interface SpecFramework {
  /** Machine id used to select prompt guidance. */
  id: "aidlc" | "sdd" | "generic";
  /** Human label for the UI / prompt. */
  label: string;
  /** Framework-specific guidance on what to clarify before refining. */
  guidance: string;
}

const AIDLC_GUIDANCE = `This project follows AIDLC (AI-Driven Development Life-Cycle). Honor its phases — Inception (intent & requirements), Construction (design & build), Operation — and its intent-first, spec-as-source-of-truth philosophy. If the AIDLC docs are not already quoted above, FIND and READ them in the repo first (Glob/Grep for aidlc-docs, .aidlc, aidlc-rules, *aidlc* files) so your questions and plan are grounded in this project's actual intent/specs. Before producing the plan, make sure you can answer: the user INTENT and the problem behind the request; the bounded scope and explicit out-of-scope; acceptance criteria and success metrics; constraints (data, security, performance, compatibility); and which existing intent/spec files this change must create or update. Ask the human about any of these that the docs leave ambiguous.`;

const SDD_GUIDANCE = `This project follows SDD (Spec-Driven Development): the specification is the source of truth and the implementation must conform to it. If the spec files are not already quoted above, FIND and READ them in the repo first (Glob/Grep for specs/, .specify/, spec.md, constitution.md). Before producing the plan, make sure the spec is unambiguous on: the exact behavior and contract being added/changed; acceptance criteria and testable assertions; edge cases and error handling; non-functional requirements (perf, security, accessibility) the spec implies; and whether the spec file itself needs updating as part of this work. Ask the human to resolve any spec gap or contradiction rather than guessing.`;

const GENERIC_GUIDANCE = `This project ships requirement docs. Treat them as the source of truth and ask the human to resolve any ambiguity or gap between the request and those docs before producing the plan.`;

const FW_SKIP_DIRS = new Set([...SKIP_DIRS, "public", "assets", "static"]);

/**
 * Probe the repo (bounded BFS) for well-known framework marker directories/files
 * so detection works even when the project's spec_globs are misconfigured or
 * empty. Cheap: inspects names only, capped depth/visits.
 */
function detectFrameworkByMarkers(root: string): "aidlc" | "sdd" | null {
  if (!root || !fs.existsSync(root)) return null;
  let visited = 0;
  let sawSdd = false;
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (visited++ > 600) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const name = e.name.toLowerCase();
      if (e.isFile()) {
        if (name.includes("aidlc")) return "aidlc"; // e.g. aidlc-state.md
        if (name === "constitution.md") sawSdd = true; // spec-kit
        continue;
      }
      if (!e.isDirectory()) continue;
      if (name.includes("aidlc")) return "aidlc"; // .aidlc / aidlc-docs / aidlc-rules
      if (name === ".specify" || name === ".sdd") sawSdd = true;
      if (FW_SKIP_DIRS.has(name)) continue;
      if (depth < 3) queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return sawSdd ? "sdd" : null;
}

/**
 * Detect which spec framework (if any) a project uses — from its spec file
 * paths/content AND from marker directories in the repo. Returns null when there
 * are neither spec docs nor framework markers.
 */
export function detectSpecFramework(project: Project): SpecFramework | null {
  const files = collectSpecFiles(project);
  const hay = files
    .map((f) => `${f.path}\n${f.content.slice(0, 1500)}`)
    .join("\n")
    .toLowerCase();
  const markers = detectFrameworkByMarkers(project.repo_path);

  const isAidlc =
    markers === "aidlc" ||
    /\baidlc\b/.test(hay) ||
    /ai[-\s]?driven\s+development\s+life[-\s]?cycle/.test(hay) ||
    (/\binception\b/.test(hay) && /\bconstruction\b/.test(hay)) ||
    /\bintent\.(md|yaml|yml)\b/.test(hay);
  if (isAidlc) return { id: "aidlc", label: "AIDLC", guidance: AIDLC_GUIDANCE };

  const isSdd =
    markers === "sdd" ||
    /spec[-\s]?driven/.test(hay) ||
    /\bsdd\b/.test(hay) ||
    /\bspec(ification)?\.(md|yaml|yml)\b/.test(hay) ||
    /##\s*acceptance criteria/.test(hay);
  if (isSdd) return { id: "sdd", label: "SDD", guidance: SDD_GUIDANCE };

  if (files.length > 0)
    return { id: "generic", label: "requirement docs", guidance: GENERIC_GUIDANCE };
  return null;
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
