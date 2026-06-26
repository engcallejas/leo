"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { AccountProjects } from "@/components/AccountProjects";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { api } from "@/components/client";
import { EngineAuthSettings } from "@/components/EngineAuthSettings";
import { IntegrationsManager } from "@/components/IntegrationsManager";
import { ErrorBar, useConfirm } from "@/components/ui";

type Tab = "proyectos" | "motor" | "integraciones" | "general";

const TABS: { key: Tab; label: string }[] = [
  { key: "proyectos", label: "Proyectos" },
  { key: "integraciones", label: "Integraciones" },
  { key: "motor", label: "Motor & Auth" },
  { key: "general", label: "General" },
];

export default function AccountPage() {
  const { accounts } = useAccount();
  const [tab, setTab] = useState<Tab>("proyectos");

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ marginBottom: 22 }}>
        <div
          className="ed-display"
          style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}
        >
          Cuenta activa — workspace aislado (proyectos, integraciones, motor/auth)
        </div>
        <AccountSwitcher />
      </div>

      <div className="acct-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`acct-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        {tab === "proyectos" && <AccountProjects />}
        {tab === "integraciones" && <IntegrationsManager />}
        {tab === "motor" && <EngineAuthSettings />}
        {tab === "general" && <AccountGeneral accountCount={accounts.length} />}
      </div>
    </div>
  );
}

const PALETTE = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
];

function AccountGeneral({ accountCount }: { accountCount: number }) {
  const { activeAccount, refresh } = useAccount();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (activeAccount) {
      setName(activeAccount.name);
      setColor(activeAccount.color);
    }
  }, [activeAccount]);

  if (!activeAccount) return <div className="muted">Cargando…</div>;

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await api.put(`/api/accounts/${activeAccount.id}`, { name, color });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: "Eliminar cuenta",
        body: `¿Eliminar la cuenta “${activeAccount.name}” y TODOS sus proyectos, integraciones, tareas y runs? No se puede deshacer.`,
        confirmLabel: "Eliminar cuenta",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      await api.del(`/api/accounts/${activeAccount.id}`);
      // Switching to another account also reloads the app.
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 24, maxWidth: 640 }}>
      <section className="fieldset">
        <h2 className="fieldset-title">Identidad de la cuenta</h2>
        <p className="fieldset-desc">
          Nombre y color con que aparece en el selector del sidebar.
        </p>

        <div className="form-grid">
          <div className="span-2">
            <label className="label">Nombre</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="span-2">
            <label className="label">Color</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  title={c}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    background: c,
                    border:
                      color === c
                        ? "2px solid var(--text)"
                        : "2px solid transparent",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {err && (
          <div style={{ marginTop: 12 }}>
            <ErrorBar text={err} />
          </div>
        )}

        <div
          style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18 }}
        >
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={busy || !name.trim()}
          >
            Guardar
          </button>
          {saved && <span className="badge badge-ok badge-dot">guardado</span>}
        </div>
      </section>

      <section className="fieldset" style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
        <h2 className="fieldset-title">Zona de peligro</h2>
        <p className="fieldset-desc">
          Eliminar la cuenta borra sus proyectos, integraciones, tareas y runs.
          {accountCount <= 1 && " No puedes eliminar la única cuenta."}
        </p>
        <button
          className="btn btn-danger"
          onClick={remove}
          disabled={busy || accountCount <= 1}
        >
          Eliminar esta cuenta
        </button>
      </section>

      {dialog}
    </div>
  );
}
