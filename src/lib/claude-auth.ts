import { spawn } from "child_process";
import fs from "fs";
import { getActiveAccountId } from "./account-repo";
import { query, run } from "./db";
import { getResolvedProject } from "./repo";
import { getSettings } from "./settings";
import type { AuthMethod, ExecConfig, Project } from "./types";

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

// ---------- token storage (per account) ----------
export async function getStoredToken(accountId: number): Promise<string | null> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM settings WHERE account_id = ? AND key = ?",
    [accountId, TOKEN_KEY],
  );
  const v = rows[0]?.value?.trim();
  return v || null;
}

export async function setStoredToken(
  accountId: number,
  token: string,
): Promise<void> {
  await putSetting(accountId, TOKEN_KEY, token.trim());
  g.__leoAuthCache = undefined; // invalidate
}

export async function clearStoredToken(accountId: number): Promise<void> {
  await run("DELETE FROM settings WHERE account_id = ? AND key = ?", [
    accountId,
    TOKEN_KEY,
  ]);
  g.__leoAuthCache = undefined;
}

// ---------- exec config (per-account model/auth defaults) ----------
const METHOD_KEY = "anthropic_auth_method";
const APIKEY_KEY = "anthropic_api_key";
const MODEL_KEY = "default_model";

async function getSetting(
  accountId: number,
  key: string,
): Promise<string | null> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM settings WHERE account_id = ? AND key = ?",
    [accountId, key],
  );
  return rows[0]?.value ?? null;
}
async function putSetting(
  accountId: number,
  key: string,
  value: string,
): Promise<void> {
  await run(
    "INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value",
    [accountId, key, value],
  );
}

export async function getAnthropicApiKey(
  accountId: number,
): Promise<string | null> {
  const v = (await getSetting(accountId, APIKEY_KEY))?.trim();
  return v || process.env.ANTHROPIC_API_KEY || null;
}

export async function getExecConfig(accountId: number): Promise<ExecConfig> {
  const method = (await getSetting(accountId, METHOD_KEY)) as AuthMethod | null;
  const key = await getAnthropicApiKey(accountId);
  return {
    method: method === "api-key" ? "api-key" : "subscription",
    apiKeySet: !!key,
    defaultModel: (await getSetting(accountId, MODEL_KEY)) ?? "",
  };
}

export async function setExecConfig(
  accountId: number,
  patch: {
    method?: AuthMethod;
    defaultModel?: string;
    apiKey?: string | null;
  },
): Promise<ExecConfig> {
  if (patch.method) await putSetting(accountId, METHOD_KEY, patch.method);
  if (patch.defaultModel !== undefined)
    await putSetting(accountId, MODEL_KEY, patch.defaultModel.trim());
  if (patch.apiKey !== undefined) {
    if (patch.apiKey) await putSetting(accountId, APIKEY_KEY, patch.apiKey.trim());
    else
      await run("DELETE FROM settings WHERE account_id = ? AND key = ?", [
        accountId,
        APIKEY_KEY,
      ]);
  }
  g.__leoAuthCache = undefined;
  return getExecConfig(accountId);
}

/**
 * Effective auth method + model + key for a project. Resolves the project→base
 * inheritance chain first (so an inherited model/auth_method is honored), then
 * falls back to the project's *account* exec config.
 */
export async function resolveProjectExec(project: Project): Promise<{
  method: AuthMethod;
  apiKey: string | null;
  model: string | null;
}> {
  const resolved = (await getResolvedProject(project.id)) ?? project;
  const accountId = resolved.account_id;
  const cfg = await getExecConfig(accountId);
  const method: AuthMethod =
    resolved.auth_method === "inherit" ? cfg.method : resolved.auth_method;
  return {
    method,
    apiKey: method === "api-key" ? await getAnthropicApiKey(accountId) : null,
    model:
      (resolved.model && resolved.model.trim()) || cfg.defaultModel || null,
  };
}

/** Gate: can this project actually run with its effective auth? */
export async function assertRunnable(
  project: Project,
): Promise<{ ok: boolean; reason?: string }> {
  const exec = await resolveProjectExec(project);
  if (exec.method === "api-key") {
    return exec.apiKey
      ? { ok: true }
      : {
          ok: false,
          reason:
            "Método API key seleccionado pero no hay ANTHROPIC_API_KEY configurada (Ajustes → Modelo y proveedor).",
        };
  }
  const auth = await getAuthStatus();
  return auth.authenticated
    ? { ok: true }
    : {
        ok: false,
        reason: auth.loggedIn
          ? "Claude está autenticado por API key/consola, no por suscripción."
          : `No autenticado con suscripción Claude. ${auth.error ?? "Ve a Ajustes → Autenticación."}`,
      };
}

/**
 * Environment for spawning `claude`. For subscription: strips ANTHROPIC_API_KEY
 * and injects the OAuth token. For api-key: sets ANTHROPIC_API_KEY.
 */
export async function buildClaudeEnv(opts?: {
  accountId?: number;
  method?: AuthMethod;
  apiKey?: string | null;
  extra?: Record<string, string>;
}): Promise<NodeJS.ProcessEnv> {
  const accountId = opts?.accountId ?? (await getActiveAccountId());
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.FORCE_COLOR = "0";

  if (opts?.method === "api-key") {
    const key = opts.apiKey ?? (await getAnthropicApiKey(accountId));
    if (key) env.ANTHROPIC_API_KEY = key;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    // subscription
    delete env.ANTHROPIC_API_KEY;
    const token =
      (await getStoredToken(accountId)) || process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  }

  return { ...env, ...(opts?.extra ?? {}) };
}

const CURATED_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-fable-5",
];

/** Models for the dropdown: live from Anthropic if an API key is set, else curated. */
export async function listModels(accountId: number): Promise<string[]> {
  const ids = new Set(CURATED_MODELS);
  const key = await getAnthropicApiKey(accountId);
  if (key) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { id?: string }[] };
        for (const m of body.data ?? []) if (m.id) ids.add(m.id);
      }
    } catch {
      /* fall back to curated */
    }
  }
  return [...ids];
}

/** Validate an Anthropic API key against the models endpoint. */
export async function testApiKey(
  accountId: number,
  key?: string,
): Promise<{ ok: boolean; message: string }> {
  const k = key?.trim() || (await getAnthropicApiKey(accountId));
  if (!k) return { ok: false, message: "No hay API key configurada." };
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": k, "anthropic-version": "2023-06-01" },
    });
    if (res.ok) return { ok: true, message: "API key válida ✓" };
    if (res.status === 401)
      return { ok: false, message: "API key inválida (401)." };
    return { ok: false, message: `Anthropic respondió ${res.status}.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
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
  const accountId = await getActiveAccountId();
  const settings = await getSettings(accountId);
  const env = await buildClaudeEnv({ accountId });
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

  const stored = await getStoredToken(await getActiveAccountId());
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
