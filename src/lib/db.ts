import { createClient, type Client, type InArgs } from "@libsql/client";
import fs from "fs";
import path from "path";
import { SCHEMA } from "./schema";

// All persistent local state lives under <DATA_DIR> (overridable via env so the
// Docker image can point it at a mounted volume).
export const DATA_DIR = process.env.LEO_DATA_DIR
  ? path.resolve(process.env.LEO_DATA_DIR)
  : path.join(process.cwd(), "data");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "leo.db");

function ensureDirs() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Survive Next.js HMR / multiple imports in dev with a global singleton.
const globalForDb = globalThis as unknown as {
  __leoDb?: Client;
  __leoMigrate?: Promise<void>;
};

export function getDb(): Client {
  if (!globalForDb.__leoDb) {
    ensureDirs();
    globalForDb.__leoDb = createClient({ url: `file:${DB_PATH}` });
  }
  return globalForDb.__leoDb;
}

async function ensureColumn(
  db: Client,
  table: string,
  column: string,
  decl: string,
): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  const has = info.rows.some((r) => (r as { name?: string }).name === column);
  if (!has) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/**
 * Older DBs created run_interactions.run_id as NOT NULL (REFERENCES runs). To
 * let plan refinements raise interactions (run_id NULL, plan_id set), rebuild
 * the table once if run_id is still NOT NULL. SQLite can't ALTER a column's
 * nullability, so we copy through a temp table. Idempotent.
 */
async function relaxInteractionsRunId(db: Client): Promise<void> {
  const info = await db.execute("PRAGMA table_info(run_interactions)");
  const runIdCol = info.rows.find(
    (r) => (r as { name?: string }).name === "run_id",
  ) as { notnull?: number } | undefined;
  if (!runIdCol || Number(runIdCol.notnull) !== 1) return; // already nullable
  await db.executeMultiple(`
    BEGIN;
    CREATE TABLE run_interactions_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      INTEGER,
      plan_id     INTEGER,
      task_id     INTEGER,
      kind        TEXT NOT NULL DEFAULT 'question',
      question    TEXT NOT NULL,
      options     TEXT NOT NULL DEFAULT '[]',
      status      TEXT NOT NULL DEFAULT 'pending',
      answer      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      answered_at TEXT
    );
    INSERT INTO run_interactions_new
      (id, run_id, plan_id, task_id, kind, question, options, status, answer, created_at, answered_at)
      SELECT id, run_id, plan_id, task_id, kind, question, options, status, answer, created_at, answered_at
      FROM run_interactions;
    DROP TABLE run_interactions;
    ALTER TABLE run_interactions_new RENAME TO run_interactions;
    CREATE INDEX IF NOT EXISTS idx_interactions_run ON run_interactions(run_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_plan ON run_interactions(plan_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_status ON run_interactions(status);
    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
}

const DEFAULT_SETTINGS: Record<string, string> = {
  poll_interval_seconds: "60",
  max_concurrent_runs: "2",
  claude_binary_path: "claude",
  auto_run_enabled: "true",
};

// Idempotent, cached: the schema is applied exactly once per process and any
// concurrent caller awaits the same promise. Called automatically before every
// query so route handlers never need to bootstrap explicitly.
export function migrate(): Promise<void> {
  if (!globalForDb.__leoMigrate) {
    globalForDb.__leoMigrate = (async () => {
      ensureDirs();
      const db = getDb();
      await db.executeMultiple(SCHEMA);
      // Additive migrations for already-existing databases.
      await ensureColumn(
        db,
        "projects",
        "resolve_source_on_done",
        "INTEGER NOT NULL DEFAULT 1",
      );
      await ensureColumn(db, "tasks", "scheduled_for", "TEXT");
      await ensureColumn(
        db,
        "projects",
        "auth_method",
        "TEXT NOT NULL DEFAULT 'inherit'",
      );
      // Round 2: per-project MCPs, hooks, requirement specs, interactivity, and
      // source roles (planning vs development).
      await ensureColumn(db, "projects", "mcp_servers", "TEXT NOT NULL DEFAULT '[]'");
      await ensureColumn(db, "projects", "strict_mcp", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(db, "projects", "hooks", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db, "projects", "spec_globs", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(db, "projects", "interactive", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(
        db,
        "tasks",
        "source_role",
        "TEXT NOT NULL DEFAULT 'development'",
      );
      // ClickUp subtask chain execution (one run per subtask, shared branch).
      await ensureColumn(db, "tasks", "parent_task_id", "INTEGER");
      await ensureColumn(db, "tasks", "chain_branch", "TEXT");
      // Plan-scoped interactions: add plan_id and relax run_id (NOT NULL → NULL)
      // so refinement can ask the human, reusing the run_interactions table.
      await ensureColumn(db, "run_interactions", "plan_id", "INTEGER");
      await relaxInteractionsRunId(db);
      await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_interactions_plan ON run_interactions(plan_id)",
      );
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await db.execute({
          sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
          args: [key, value],
        });
      }
    })();
  }
  return globalForDb.__leoMigrate;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  args: InArgs = [],
): Promise<T[]> {
  await migrate();
  const res = await getDb().execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  args: InArgs = [],
): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(
  sql: string,
  args: InArgs = [],
): Promise<{ lastInsertRowid: number; rowsAffected: number }> {
  await migrate();
  const res = await getDb().execute({ sql, args });
  return {
    lastInsertRowid:
      res.lastInsertRowid != null ? Number(res.lastInsertRowid) : 0,
    rowsAffected: res.rowsAffected,
  };
}
