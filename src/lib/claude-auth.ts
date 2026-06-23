import { spawn } from "child_process";
import fs from "fs";
import { query, run } from "./db";
import { getSettings } from "./settings";

export interface AuthStatus {
  loggedIn: boolean;
  /** True only when logged in via a Claude *subscription* (not API key). */
  authenticated: boolean;
  isSubscription: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  subscriptionType: string | null;
  email: string | null;
  orgName: string | null;
  /** Leo has an OAuth token stored (settings) or provided via env. */
  hasStoredToken: boolean;
  /** Running inside a container (no host browser/terminal available). */
  inContainer: boolean;
  /** We can launch the interactive auth flow in a real terminal (macOS host). */
  canLaunchTerminal: boolean;
  checkedAt: string;
  error: string | null;
}

export function envFlags(): { inContainer: boolean; canLaunchTerminal: boolean } {
  let inContainer = false;
  try {
    inContainer =
      fs.existsSync("/.dockerenv") || process.env.LEO_IN_CONTAINER === "1";
  } catch {
    /* ignore */
  }
  return {
    inContainer,
    canLaunchTerminal: process.platform === "darwin" && !inContainer,
  };
}

const TOKEN_KEY = "claude_oauth_token";

const g = globalThis as unknown as {
  __leoAuthCache?: { value: AuthStatus; at: number };
};

// ---------- token storage ----------
export async function getStoredToken(): Promise<string | null> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [TOKEN_KEY],
  );
  const v = rows[0]?.value?.trim();
  return v || null;
}

export async function setStoredToken(token: string): Promise<void> {
  await run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [TOKEN_KEY, token.trim()],
  );
  g.__leoAuthCache = undefined; // invalidate
}

export async function clearStoredToken(): Promise<void> {
  await run("DELETE FROM settings WHERE key = ?", [TOKEN_KEY]);
  g.__leoAuthCache = undefined;
}

/**
 * Environment for spawning `claude`. Forces the *subscription* auth path:
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are stripped so the CLI can only use
 * OAuth (keychain / credentials file / CLAUDE_CODE_OAUTH_TOKEN). A token stored
 * in Leo (or already present in the process env) is injected.
 */
export async function buildClaudeEnv(
  extra: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.FORCE_COLOR = "0";

  const stored = await getStoredToken();
  const token = stored || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;

  return { ...env, ...extra };
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

/** Run the claude CLI capturing output, with a hard timeout. */
export async function execClaude(
  args: string[],
  timeoutMs = 20000,
): Promise<ExecResult> {
  const settings = await getSettings();
  const env = await buildClaudeEnv();
  return new Promise<ExecResult>((resolve) => {
    let child;
    try {
      child = spawn(settings.claude_binary_path, args, { env });
    } catch (e) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        spawnError: (e as Error).message,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut, spawnError: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function unauthenticated(error: string, hasStoredToken: boolean): AuthStatus {
  return {
    loggedIn: false,
    authenticated: false,
    isSubscription: false,
    authMethod: null,
    apiProvider: null,
    subscriptionType: null,
    email: null,
    orgName: null,
    hasStoredToken,
    ...envFlags(),
    checkedAt: new Date().toISOString(),
    error,
  };
}

/**
 * Resolve the current Claude auth status by calling `claude auth status --json`.
 * Cached for 30s (the sidebar polls frequently); pass force=true to refresh.
 */
export async function getAuthStatus(force = false): Promise<AuthStatus> {
  if (!force && g.__leoAuthCache && Date.now() - g.__leoAuthCache.at < 30_000) {
    return g.__leoAuthCache.value;
  }

  const stored = await getStoredToken();
  const hasStoredToken = !!(stored || process.env.CLAUDE_CODE_OAUTH_TOKEN);

  const res = await execClaude(["auth", "status", "--json"], 20000);

  let status: AuthStatus;
  if (res.spawnError) {
    status = unauthenticated(
      `No se pudo ejecutar el binario claude (${res.spawnError}). Revisa la ruta en Ajustes.`,
      hasStoredToken,
    );
  } else if (res.timedOut) {
    status = unauthenticated(
      "El chequeo de autenticación expiró (timeout).",
      hasStoredToken,
    );
  } else {
    try {
      const json = JSON.parse(res.stdout.trim()) as Record<string, unknown>;
      const loggedIn = json.loggedIn === true;
      const apiProvider = (json.apiProvider as string) ?? null;
      const isSubscription = apiProvider === "firstParty";
      status = {
        loggedIn,
        authenticated: loggedIn && isSubscription,
        isSubscription,
        authMethod: (json.authMethod as string) ?? null,
        apiProvider,
        subscriptionType: (json.subscriptionType as string) ?? null,
        email: (json.email as string) ?? null,
        orgName: (json.orgName as string) ?? null,
        hasStoredToken,
        ...envFlags(),
        checkedAt: new Date().toISOString(),
        error: null,
      };
    } catch {
      const detail = (res.stderr || res.stdout || "").trim().slice(0, 300);
      status = unauthenticated(
        detail || "No autenticado.",
        hasStoredToken,
      );
    }
  }

  g.__leoAuthCache = { value: status, at: Date.now() };
  return status;
}
