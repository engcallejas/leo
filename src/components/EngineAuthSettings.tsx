"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/client";
import { ModelInput } from "@/components/ModelInput";
import { ErrorBar } from "@/components/ui";
import type { AuthStatus } from "@/lib/claude-auth";
import type { AppSettings, AuthMethod, ExecConfig } from "@/lib/types";

/**
 * Per-account engine + model/auth config. (Auth *status* — the subscription
 * login — is machine-wide; only the chosen method / API key / model / token are
 * per account.) Rendered inside the unified "Cuenta" page; a workspace switch
 * reloads the app, so this just fetches the active account's config on mount.
 */
export function EngineAuthSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/api/settings")
      .then(setS)
      .catch((e) => setErr(e.message));
  }, []);

  const save = async () => {
    if (!s) return;
    setErr(null);
    setSaved(false);
    try {
      const next = await api.put("/api/settings", s);
      setS(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <AuthSection />
      <ExecSection />

      {!s ? (
        <div className="muted">Cargando…</div>
      ) : (
        <section className="fieldset">
          <h2 className="fieldset-title">Motor (esta cuenta)</h2>
          <p className="fieldset-desc">
            Límite de ejecución concurrente y binario, propios de la cuenta. El
            intervalo de polling es global (un solo timer del proceso).
          </p>

          <div className="form-grid">
            <Num
              label="Intervalo de polling (segundos)"
              hint="Global. Cada cuánto el scheduler consulta las fuentes. Mínimo 5."
              value={s.poll_interval_seconds}
              min={5}
              onChange={(v) => setS({ ...s, poll_interval_seconds: v })}
            />
            <Num
              label="Runs concurrentes máximos (cuenta)"
              hint="Cuántos procesos de claude corren a la vez en esta cuenta."
              value={s.max_concurrent_runs}
              min={1}
              onChange={(v) => setS({ ...s, max_concurrent_runs: v })}
            />

            <div className="span-2">
              <label className="label">Ruta del binario claude</label>
              <input
                className="input"
                value={s.claude_binary_path}
                onChange={(e) =>
                  setS({ ...s, claude_binary_path: e.target.value })
                }
              />
              <div className="hint">
                Por defecto <code>claude</code> (debe estar en el PATH del
                proceso). Usa una ruta absoluta si hace falta.
              </div>
            </div>

            <label
              className="span-2"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "4px 0",
              }}
            >
              <input
                type="checkbox"
                checked={s.auto_run_enabled}
                onChange={(e) =>
                  setS({ ...s, auto_run_enabled: e.target.checked })
                }
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Auto-run habilitado (esta cuenta)
                </div>
                <div className="hint" style={{ marginTop: 0 }}>
                  Si está apagado, el scheduler sigue consultando pero nunca
                  ejecuta solo los proyectos en auto-mode de esta cuenta.
                </div>
              </div>
            </label>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginTop: 18,
            }}
          >
            <button className="btn btn-primary" onClick={save}>
              Guardar
            </button>
            {saved && <span className="badge badge-ok badge-dot">guardado</span>}
          </div>
        </section>
      )}

      {err && <ErrorBar text={err} />}
    </div>
  );
}

function AuthSection() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = (force = false) =>
    api
      .get(`/api/auth${force ? "?force=true" : ""}`)
      .then(setAuth)
      .catch((e) => setErr(e.message));

  const launchTerminal = async () => {
    setLaunching(true);
    setErr(null);
    try {
      await api.post("/api/auth/login", { tool: "setup-token" });
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const a = await api.get("/api/auth?force=true");
        setAuth(a);
        if (a.authenticated) break;
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveToken = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await api.post("/api/auth/token", { token });
      setAuth(next);
      setToken("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearToken = async () => {
    setBusy(true);
    setErr(null);
    try {
      setAuth(await api.del("/api/auth/token"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ok = auth?.authenticated;

  return (
    <section className="fieldset">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <h2 className="fieldset-title">Autenticación de Claude</h2>
          <p className="fieldset-desc">
            La sesión de suscripción es del equipo (una por máquina). El token y
            la API key se guardan por cuenta.
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={busy}>
          Revalidar
        </button>
      </div>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--panel-2)",
          padding: 16,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className={
              ok ? "badge badge-ok badge-dot" : "badge badge-danger badge-dot"
            }
          >
            {ok ? "Suscripción activa" : "No autenticado"}
          </span>
          {auth?.email && (
            <span className="muted" style={{ fontSize: 13 }}>
              {auth.email}
              {auth.subscriptionType ? ` · plan ${auth.subscriptionType}` : ""}
              {auth.authMethod ? ` · ${auth.authMethod}` : ""}
            </span>
          )}
        </div>

        {!ok && (
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            {auth?.loggedIn ? (
              <>
                Claude está autenticado por <b>API key / consola</b>, no por
                suscripción.
              </>
            ) : (
              <>
                Leo ejecuta Claude Code con tu <b>suscripción</b> o una API key
                por cuenta.
              </>
            )}
            {auth?.error && (
              <div style={{ marginTop: 6, color: "var(--danger)" }}>
                {auth.error}
              </div>
            )}
          </div>
        )}

        {!ok && auth?.canLaunchTerminal && (
          <div>
            <button
              className="btn btn-primary"
              onClick={launchTerminal}
              disabled={launching}
            >
              {launching
                ? "Esperando autenticación en Terminal…"
                : "Autenticar en Terminal"}
            </button>
            <div className="hint">
              Abre una ventana de Terminal con <code>claude setup-token</code>.
              Completa el login en el navegador; Leo lo detectará solo.
            </div>
          </div>
        )}

        {!ok && !auth?.canLaunchTerminal && (
          <div className="hint" style={{ margin: 0 }}>
            En este entorno (Docker/Linux) genera el token en una máquina con tu
            suscripción: <code>claude setup-token</code>, y pégalo aquí.
          </div>
        )}

        {(!ok || auth?.hasStoredToken) && (
          <div style={{ display: "grid", gap: 10 }}>
            {!ok && (
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  className="input"
                  type="password"
                  placeholder="CLAUDE_CODE_OAUTH_TOKEN (sk-ant-oat…)"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={saveToken}
                  disabled={busy || token.trim().length < 10}
                  style={{ whiteSpace: "nowrap" }}
                >
                  Guardar token
                </button>
              </div>
            )}
            {auth?.hasStoredToken && (
              <div>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={clearToken}
                  disabled={busy}
                >
                  Quitar token guardado
                </button>
              </div>
            )}
          </div>
        )}

        {err && <ErrorBar text={err} />}
      </div>
    </section>
  );
}

function ExecSection() {
  const [cfg, setCfg] = useState<ExecConfig | null>(null);
  const [key, setKey] = useState("");
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get("/api/exec")
      .then(setCfg)
      .catch((e) => setErr(e.message));
  }, []);

  if (!cfg) return null;

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const body: {
        method: AuthMethod;
        defaultModel: string;
        apiKey?: string;
      } = { method: cfg.method, defaultModel: cfg.defaultModel };
      if (key) body.apiKey = key;
      const next = await api.put("/api/exec", body);
      setCfg(next);
      setKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clearKey = async () => {
    setBusy(true);
    try {
      setCfg(await api.put("/api/exec", { apiKey: null }));
      setTest(null);
    } finally {
      setBusy(false);
    }
  };
  const probar = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await api.post("/api/exec/test", key ? { apiKey: key } : {}));
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fieldset">
      <h2 className="fieldset-title">Modelo y proveedor (esta cuenta)</h2>
      <p className="fieldset-desc">
        Método de autenticación de la cuenta y el modelo por defecto de sus
        proyectos.
      </p>

      <div className="form-grid">
        <div>
          <label className="label">Método de autenticación (cuenta)</label>
          <select
            className="select"
            value={cfg.method}
            onChange={(e) =>
              setCfg({ ...cfg, method: e.target.value as AuthMethod })
            }
          >
            <option value="subscription">Suscripción de Claude</option>
            <option value="api-key">API key de Anthropic</option>
          </select>
          <div className="hint">
            Cada proyecto puede heredar esto o forzar su propio método.
          </div>
        </div>

        <div>
          <label className="label">Modelo por defecto</label>
          <ModelInput
            value={cfg.defaultModel}
            onChange={(v) => setCfg({ ...cfg, defaultModel: v })}
            placeholder="(vacío = el que elija Claude Code)"
          />
          <div className="hint">
            Se usa cuando un proyecto no especifica su propio modelo.
          </div>
        </div>

        {cfg.method === "api-key" && (
          <div className="span-2">
            <label className="label">
              ANTHROPIC_API_KEY{" "}
              {cfg.apiKeySet && (
                <span className="badge badge-ok badge-dot">configurada</span>
              )}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                type="password"
                placeholder={
                  cfg.apiKeySet ? "•••• (vacío = conservar)" : "sk-ant-..."
                }
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="btn" onClick={probar} disabled={busy}>
                Probar
              </button>
              {cfg.apiKeySet && (
                <button
                  className="btn btn-danger"
                  onClick={clearKey}
                  disabled={busy}
                >
                  Quitar
                </button>
              )}
            </div>
            {test && (
              <div
                className={`card ${test.ok ? "badge-ok" : "badge-danger"}`}
                style={{ padding: "8px 12px", fontSize: 13, marginTop: 8 }}
              >
                {test.message}
              </div>
            )}
            <div className="hint">
              Usa facturación por API (no suscripción). Se guarda por cuenta en
              data/leo.db.
            </div>
          </div>
        )}
      </div>

      {err && (
        <div style={{ marginTop: 14 }}>
          <ErrorBar text={err} />
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 18,
        }}
      >
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Guardar
        </button>
        {saved && <span className="badge badge-ok badge-dot">guardado</span>}
      </div>
    </section>
  );
}

function Num({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
