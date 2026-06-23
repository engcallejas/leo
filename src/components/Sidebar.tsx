"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "◧" },
  { href: "/projects", label: "Proyectos", icon: "▤" },
  { href: "/integrations", label: "Integraciones", icon: "⚇" },
  { href: "/runs", label: "Ejecuciones", icon: "▶" },
  { href: "/settings", label: "Ajustes", icon: "⚙" },
];

interface SchedStatus {
  scheduler: { started: boolean; lastTickAt: string | null; activeRuns: number };
  counts: { runningRuns: number; pendingTasks: number };
}

interface AuthLite {
  authenticated: boolean;
  loggedIn: boolean;
  email: string | null;
  subscriptionType: string | null;
}

export function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SchedStatus | null>(null);
  const [auth, setAuth] = useState<AuthLite | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, a] = await Promise.all([
          fetch("/api/scheduler", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch("/api/auth", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        if (alive) {
          if (s) setStatus(s);
          if (a) setAuth(a);
        }
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <aside
      style={{
        width: 232,
        borderRight: "1px solid var(--border)",
        padding: "20px 14px",
        position: "sticky",
        top: 0,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "var(--panel)",
      }}
    >
      <div style={{ padding: "4px 12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "var(--accent)",
            color: "var(--accent-fg)",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 16,
          }}
        >
          L
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Leo</div>
          <div className="muted" style={{ fontSize: 11 }}>
            Claude Code orchestrator
          </div>
        </div>
      </div>

      {LINKS.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link ${active ? "active" : ""}`}
          >
            <span style={{ width: 16, textAlign: "center", opacity: 0.8 }}>
              {l.icon}
            </span>
            {l.label}
          </Link>
        );
      })}

      <div style={{ marginTop: "auto" }} />

      <Link
        href="/settings"
        className="card"
        style={{
          padding: "10px 12px",
          background: "var(--panel-2)",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: auth?.authenticated ? "var(--ok)" : "var(--danger)",
              boxShadow: auth?.authenticated ? "0 0 8px var(--ok)" : "none",
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {auth?.authenticated ? "Suscripción activa" : "No autenticado"}
          </span>
        </div>
        <div
          className="muted"
          style={{
            fontSize: 11,
            marginTop: 5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {auth?.authenticated
            ? `${auth.email ?? ""}${auth.subscriptionType ? ` · ${auth.subscriptionType}` : ""}`
            : "Configura tu suscripción Claude →"}
        </div>
      </Link>

      <div
        className="card"
        style={{ padding: "11px 12px", background: "var(--panel-2)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: status?.scheduler.started ? "var(--ok)" : "var(--muted)",
              boxShadow: status?.scheduler.started
                ? "0 0 8px var(--ok)"
                : "none",
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            Scheduler {status?.scheduler.started ? "activo" : "—"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {status ? (
            <>
              {status.scheduler.activeRuns} corriendo · {status.counts.pendingTasks}{" "}
              pendientes
            </>
          ) : (
            "cargando…"
          )}
        </div>
      </div>
    </aside>
  );
}
