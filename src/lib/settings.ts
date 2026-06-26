import { query, run } from "./db";
import type { AppSettings } from "./types";

const DEFAULTS: AppSettings = {
  poll_interval_seconds: 60,
  max_concurrent_runs: 2,
  claude_binary_path: "claude",
  auto_run_enabled: true,
};

export async function getSettings(accountId: number): Promise<AppSettings> {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE account_id = ?",
    [accountId],
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    poll_interval_seconds: num(
      map.get("poll_interval_seconds"),
      DEFAULTS.poll_interval_seconds,
    ),
    max_concurrent_runs: num(
      map.get("max_concurrent_runs"),
      DEFAULTS.max_concurrent_runs,
    ),
    claude_binary_path:
      map.get("claude_binary_path") || DEFAULTS.claude_binary_path,
    auto_run_enabled: (map.get("auto_run_enabled") ?? "true") === "true",
  };
}

export async function updateSettings(
  accountId: number,
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const entries: [string, string][] = [];
  if (patch.poll_interval_seconds != null)
    entries.push([
      "poll_interval_seconds",
      String(Math.max(5, Math.floor(patch.poll_interval_seconds))),
    ]);
  if (patch.max_concurrent_runs != null)
    entries.push([
      "max_concurrent_runs",
      String(Math.max(1, Math.floor(patch.max_concurrent_runs))),
    ]);
  if (patch.claude_binary_path != null)
    entries.push(["claude_binary_path", patch.claude_binary_path.trim()]);
  if (patch.auto_run_enabled != null)
    entries.push(["auto_run_enabled", patch.auto_run_enabled ? "true" : "false"]);

  for (const [key, value] of entries) {
    await run(
      "INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value",
      [accountId, key, value],
    );
  }
  return getSettings(accountId);
}

function num(v: string | undefined, fallback: number): number {
  const n = v != null ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
