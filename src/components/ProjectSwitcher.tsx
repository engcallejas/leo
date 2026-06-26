"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./AccountProvider";

/**
 * Project switcher pinned at the top of the sidebar — the day-to-day working
 * scope. Lists the active account's projects; picking one re-scopes the views
 * (Tablero / Planeación / Ejecuciones). The account is switched elsewhere
 * (the Cuenta page). The active account's name is shown as a small label.
 */
export function ProjectSwitcher() {
  const {
    projects,
    activeProject,
    activeProjectId,
    activeAccount,
    switchProject,
    loading,
  } = useAccount();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = loading
    ? "Cargando…"
    : (activeProject?.name ?? "Sin proyecto");

  return (
    <div ref={ref} style={{ position: "relative", padding: "0 6px 8px" }}>
      <button
        className="acct-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Cambiar de proyecto"
      >
        <span className="acct-stack">
          <span className="acct-name">{label}</span>
          {activeAccount && (
            <span className="acct-sub">{activeAccount.name}</span>
          )}
        </span>
        <span className="acct-chev">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="acct-menu">
          <div className="acct-menu-label">
            Proyectos · {activeAccount?.name ?? ""}
          </div>
          {projects.length === 0 && (
            <div
              className="muted"
              style={{ fontSize: 12, padding: "6px 8px" }}
            >
              Esta cuenta no tiene proyectos.
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              className={`acct-item ${p.id === activeProjectId ? "active" : ""}`}
              onClick={() => {
                if (p.id !== activeProjectId) switchProject(p.id);
                else setOpen(false);
              }}
            >
              <span className="acct-name">{p.name}</span>
              {p.id === activeProjectId && <span className="acct-check">✓</span>}
            </button>
          ))}

          <div className="acct-sep" />

          <button
            className="acct-item acct-add"
            onClick={() => {
              setOpen(false);
              router.push("/projects/new");
            }}
          >
            <span className="acct-dot acct-plus">＋</span>
            <span className="acct-name">Nuevo proyecto</span>
          </button>
        </div>
      )}
    </div>
  );
}
