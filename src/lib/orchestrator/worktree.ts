import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../db";

// Isolated git worktrees live under Leo's data dir (outside the repo, gitignored
// by virtue of being a separate tree) so a parallel run on a busy repo gets its
// own working directory + branch without clobbering the main checkout.
export const WORKTREES_DIR = path.join(DATA_DIR, "worktrees");

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** True if `ref` resolves in the repo (branch/commit exists). */
function refExists(repo: string, ref: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** True if `repoPath` is inside a git working tree (worktrees need this). */
export function isGitRepo(repoPath: string): boolean {
  try {
    git(repoPath, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export interface RunWorktree {
  path: string;
  branch: string;
}

/**
 * Create an isolated worktree for a run: a fresh branch `leo/run-<id>` off the
 * project's base branch (or HEAD if it doesn't resolve), checked out at a path
 * under WORKTREES_DIR. Throws with a clear message on failure so the caller can
 * fail the run instead of silently falling back to the shared checkout.
 */
export function createRunWorktree(
  repoPath: string,
  runId: number,
  baseBranch: string | null,
): RunWorktree {
  if (!isGitRepo(repoPath)) {
    throw new Error(
      `el repositorio "${repoPath}" no es un repo git (no hay .git), así que no se puede aislar en un worktree. Ejecútalo sin worktree.`,
    );
  }
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  const wtPath = path.join(WORKTREES_DIR, `run-${runId}`);
  const branch = `leo/run-${runId}`;

  // Clean up any stale leftovers from a previous attempt with the same id.
  removeRunWorktree(repoPath, wtPath);
  if (refExists(repoPath, branch)) {
    try {
      git(repoPath, ["branch", "-D", branch]);
    } catch {
      /* ignore */
    }
  }

  const base =
    baseBranch && baseBranch.trim() && refExists(repoPath, baseBranch.trim())
      ? baseBranch.trim()
      : "HEAD";
  try {
    git(repoPath, ["worktree", "add", "-b", branch, wtPath, base]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`git worktree add falló: ${msg}`);
  }
  return { path: wtPath, branch };
}

/** Remove a run's worktree from disk (idempotent, best-effort). Branch survives. */
export function removeRunWorktree(repoPath: string, wtPath: string): void {
  try {
    git(repoPath, ["worktree", "remove", "--force", wtPath]);
  } catch {
    /* not registered / already gone */
  }
  try {
    if (fs.existsSync(wtPath)) fs.rmSync(wtPath, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    git(repoPath, ["worktree", "prune"]);
  } catch {
    /* ignore */
  }
}
