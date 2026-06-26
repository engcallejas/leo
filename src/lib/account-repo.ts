// Accounts are workspaces that group projects with fully isolated integrations
// and engine/auth config. The app operates within one *active* account at a
// time (a UI pointer in app_state) — but the scheduler runs every account in
// the background regardless of which one is active.

import { query, queryOne, run } from "./db";
import type { Account } from "./types";

type AccountRow = Record<string, unknown>;

function mapAccount(r: AccountRow): Account {
  return {
    id: Number(r.id),
    name: String(r.name),
    color: String(r.color ?? "#6366f1"),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export async function listAccounts(): Promise<Account[]> {
  const rows = await query<AccountRow>("SELECT * FROM accounts ORDER BY id ASC");
  return rows.map(mapAccount);
}

export async function getAccount(id: number): Promise<Account | null> {
  const r = await queryOne<AccountRow>("SELECT * FROM accounts WHERE id = ?", [
    id,
  ]);
  return r ? mapAccount(r) : null;
}

export async function createAccount(
  name: string,
  color?: string,
): Promise<Account> {
  const res = await run(
    "INSERT INTO accounts (name, color) VALUES (?, ?)",
    [name.trim() || "Cuenta", color || "#6366f1"],
  );
  return (await getAccount(res.lastInsertRowid))!;
}

export async function updateAccount(
  id: number,
  patch: { name?: string; color?: string },
): Promise<Account | null> {
  const cur = await getAccount(id);
  if (!cur) return null;
  await run(
    "UPDATE accounts SET name = ?, color = ?, updated_at = datetime('now') WHERE id = ?",
    [patch.name?.trim() || cur.name, patch.color || cur.color, id],
  );
  return getAccount(id);
}

/**
 * Delete an account and everything scoped to it. Projects cascade to their
 * tasks/runs/plans (schema ON DELETE CASCADE); integrations and per-account
 * settings are removed explicitly. Refuses to delete the last remaining
 * account. If the deleted account was active, the active pointer moves to
 * another account.
 */
export async function deleteAccount(id: number): Promise<boolean> {
  const all = await listAccounts();
  if (all.length <= 1) return false; // never delete the last account
  await run("DELETE FROM projects WHERE account_id = ?", [id]);
  await run("DELETE FROM integrations WHERE account_id = ?", [id]);
  await run("DELETE FROM settings WHERE account_id = ?", [id]);
  await run("DELETE FROM accounts WHERE id = ?", [id]);
  const active = await getActiveAccountId();
  if (active === id) {
    const next = all.find((a) => a.id !== id);
    if (next) await setActiveAccountId(next.id);
  }
  return true;
}

// ---------- active-account pointer (install-wide UI state) ----------

/** The account the UI is currently scoped to. Falls back to the lowest id. */
export async function getActiveAccountId(): Promise<number> {
  const r = await queryOne<{ value: string }>(
    "SELECT value FROM app_state WHERE key = 'active_account_id'",
  );
  const id = r ? Number(r.value) : NaN;
  if (Number.isFinite(id)) {
    // Guard against a pointer left dangling by a deleted account.
    const exists = await queryOne<{ id: number }>(
      "SELECT id FROM accounts WHERE id = ?",
      [id],
    );
    if (exists) return id;
  }
  const first = await queryOne<{ id: number }>(
    "SELECT id FROM accounts ORDER BY id ASC LIMIT 1",
  );
  return first ? Number(first.id) : 1;
}

export async function setActiveAccountId(id: number): Promise<void> {
  await run(
    "INSERT INTO app_state (key, value) VALUES ('active_account_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(id)],
  );
  // The active project must belong to the active account — reset it to the new
  // account's first project (or clear it if the account has none).
  const first = await queryOne<{ id: number }>(
    "SELECT id FROM projects WHERE account_id = ? ORDER BY id ASC LIMIT 1",
    [id],
  );
  await setActiveProjectId(first ? Number(first.id) : null);
}

// ---------- active-project pointer (the view scope: Tablero/Planeación/Ejecuciones) ----------

/**
 * The project the views are scoped to. Self-healing: if the stored pointer is
 * missing or no longer belongs to the active account, falls back to that
 * account's first project (or null when the account has no projects).
 */
export async function getActiveProjectId(): Promise<number | null> {
  const accountId = await getActiveAccountId();
  const r = await queryOne<{ value: string }>(
    "SELECT value FROM app_state WHERE key = 'active_project_id'",
  );
  const id = r ? Number(r.value) : NaN;
  if (Number.isFinite(id)) {
    const ok = await queryOne<{ id: number }>(
      "SELECT id FROM projects WHERE id = ? AND account_id = ?",
      [id, accountId],
    );
    if (ok) return id;
  }
  const first = await queryOne<{ id: number }>(
    "SELECT id FROM projects WHERE account_id = ? ORDER BY id ASC LIMIT 1",
    [accountId],
  );
  return first ? Number(first.id) : null;
}

export async function setActiveProjectId(id: number | null): Promise<void> {
  if (id == null) {
    await run("DELETE FROM app_state WHERE key = 'active_project_id'");
    return;
  }
  await run(
    "INSERT INTO app_state (key, value) VALUES ('active_project_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(id)],
  );
}
