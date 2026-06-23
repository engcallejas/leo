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
const DB_PATH = path.join(DATA_DIR, "leo.db");

function ensureDirs() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
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
