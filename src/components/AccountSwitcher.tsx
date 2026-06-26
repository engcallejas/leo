"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "./AccountProvider";

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

/**
 * Account (workspace) switcher — lives on the Cuenta page, not the sidebar.
 * Lists accounts, switches the active one, and creates new accounts. Switching
 * an account resets the active project to that account's first project.
 */
export function AccountSwitcher() {
  const { accounts, activeAccount, activeAccountId, switchAccount, createAccount } =
    useAccount();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const submitNew = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createAccount(name.trim(), PALETTE[accounts.length % PALETTE.length]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative", width: 280 }}>
      <button
        className="acct-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Cambiar de cuenta"
      >
        <span
          className="acct-dot"
          style={{ background: activeAccount?.color ?? "var(--muted)" }}
        />
        <span className="acct-name">{activeAccount?.name ?? "Cuenta"}</span>
        <span className="acct-chev">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="acct-menu">
          <div className="acct-menu-label">Cuentas</div>
          {accounts.map((a) => (
            <button
              key={a.id}
              className={`acct-item ${a.id === activeAccountId ? "active" : ""}`}
              onClick={() => {
                if (a.id !== activeAccountId) switchAccount(a.id);
                else setOpen(false);
              }}
            >
              <span className="acct-dot" style={{ background: a.color }} />
              <span className="acct-name">{a.name}</span>
              {a.id === activeAccountId && <span className="acct-check">✓</span>}
            </button>
          ))}

          <div className="acct-sep" />

          {creating ? (
            <div className="acct-new">
              <input
                className="input"
                autoFocus
                placeholder="Nombre de la cuenta"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={submitNew}
                disabled={!name.trim() || busy}
              >
                {busy ? "…" : "Crear"}
              </button>
            </div>
          ) : (
            <button
              className="acct-item acct-add"
              onClick={() => {
                setCreating(true);
                setName("");
              }}
            >
              <span className="acct-dot acct-plus">＋</span>
              <span className="acct-name">Nueva cuenta</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
