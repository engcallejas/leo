"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/client";
import { Header } from "@/components/Header";
import { ErrorBar } from "@/components/ui";
import type { AuthStatus } from "@/lib/claude-auth";
import type { AppSettings } from "@/lib/types";

export default function SettingsPage() {
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

  if (!s) return <div className="muted">Cargando…</div>;

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <Header title="Ajustes" subtitle="Configuración global del orquestador" />
      {err && <ErrorBar text={err} />}

      <AuthCard />

      <div className="card" style={{ padding: 20, display: "grid", gap: 16 }}>
        <Num
          label="Intervalo de polling (segundos)"
          hint="Cada cuánto el scheduler consulta Sentry/ClickUp. Mínimo 5."
          value={s.poll_interval_seconds}
          min={5}
          onChange={(v) => setS({ ...s, poll_interval_seconds: v })}
        />
        <Num
          label="Runs concurrentes máximos"
          hint="Cuántos procesos de claude pueden correr a la vez."
          value={s.max_concurrent_runs}
          min={1}
          onChange={(v) => setS({ ...s, max_concurrent_runs: v })}
        />
        <div>
          <label className="label">Ruta del binario claude</label>
          <input
            className="input"
            value={s.claude_binary_path}
            onChange={(e) => setS({ ...s, claude_binary_path: e.target.value })}
          />
          <div className="hint">
            Por defecto <code>claude</code> (debe estar en el PATH del proceso).
            Usa una ruta absoluta si hace falta.
          </div>
        </div>
        <label
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
            onChange={(e) => setS({ ...s, auto_run_enabled: e.target.checked })}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Auto-run global habilitado
            </div>
            <div className="hint" style={{ marginTop: 0 }}>
              Interruptor maestro. Si está apagado, el scheduler sigue
              consultando pero nunca ejecuta solo (los proyectos en auto-mode no
              corren).
            </div>
          </div>
        </label>

        <div
          style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}
        >
          <button className="btn btn-primary" onClick={save}>
            Guardar
          </button>
          {saved && (
            <span className="badge badge-ok badge-dot">guardado</span>
          )}
        </div>
      </div>
    </div>
  );
}

function AuthCard() {
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
      // The flow runs in Terminal.app; poll until Claude reports authenticated.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Autenticación de Claude
        </div>
        <button
          className="btn btn-sm"
          onClick={() => load(true)}
          disabled={busy}
        >
          Revalidar
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <span
          className={
            ok
              ? "badge badge-ok badge-dot"
              : "badge badge-danger badge-dot"
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
        <div
          className="muted"
          style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}
        >
          {auth?.loggedIn ? (
            <>
              Claude está autenticado por <b>API key / consola</b>, no por
              suscripción. Leo solo usa suscripción.
            </>
          ) : (
            <>
              Leo ejecuta Claude Code con tu <b>suscripción</b> (nunca API key).
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
        <div style={{ marginBottom: 14 }}>
          <button
            className="btn btn-primary"
            onClick={launchTerminal}
            disabled={launching}
          >
            {launching
              ? "Esperando autenticación en Terminal…"
              : "🔑 Autenticar en Terminal"}
          </button>
          <div className="hint">
            Abre una ventana de Terminal con <code>claude setup-token</code>.
            Completa el login en el navegador; Leo lo detectará solo. (El token
            impreso sirve también para Docker.)
          </div>
        </div>
      )}

      {!ok && !auth?.canLaunchTerminal && (
        <div className="hint" style={{ marginBottom: 12 }}>
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

      {err && <div style={{ marginTop: 10 }}><ErrorBar text={err} /></div>}
    </div>
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
