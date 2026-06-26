"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import {
  IconBoard,
  IconClipboard,
  IconGear,
  IconGrid,
  IconPlay,
  LeoMark,
} from "@/components/icons";
import type { SVGProps } from "react";

type NavItem = {
  href: string;
  label: string;
  Icon: (p: SVGProps<SVGSVGElement>) => React.ReactElement;
};

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ href: "/", label: "Dashboard", Icon: IconGrid }] },
  {
    label: "Orquestación",
    items: [
      { href: "/board", label: "Tablero", Icon: IconBoard },
      { href: "/plans", label: "Planeación", Icon: IconClipboard },
      { href: "/runs", label: "Ejecuciones", Icon: IconPlay },
    ],
  },
  {
    label: "Sistema",
    items: [{ href: "/account", label: "Cuenta", Icon: IconGear }],
  },
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
interface ExecLite {
  method: "subscription" | "api-key";
  apiKeySet: boolean;
}

export function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<SchedStatus | null>(null);
  const [auth, setAuth] = useState<AuthLite | null>(null);
  const [exec, setExec] = useState<ExecLite | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, a, e] = await Promise.all([
          fetch("/api/scheduler", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch("/api/auth", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch("/api/exec", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        if (alive) {
          if (s) setStatus(s);
          if (a) setAuth(a);
          if (e) setExec(e);
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

  const usingKey = exec?.method === "api-key" && exec.apiKeySet;
  const authOk = usingKey || !!auth?.authenticated;
  const schedOk = !!status?.scheduler.started;

  return (
    <aside
      className="sidebar"
      style={{
        width: 258,
        borderRight: "1px solid var(--border)",
        padding: "18px 14px 14px",
        position: "sticky",
        top: 0,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "4px 10px 6px",
        }}
      >
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "#070a10",
            border: "1px solid var(--border)",
            display: "grid",
            placeItems: "center",
            color: "var(--accent)",
            flex: "none",
          }}
        >
          <LeoMark width={23} height={23} />
        </span>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 600,
            fontSize: 21,
            letterSpacing: "-0.01em",
          }}
        >
          Leo
        </span>
      </div>

      {/* Project switcher (the working scope) */}
      <div style={{ marginTop: 10 }}>
        <ProjectSwitcher />
      </div>

      {/* Nav groups */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
        {GROUPS.map((g, gi) => (
          <div key={gi}>
            {g.label && <div className="sidebar-group">{g.label}</div>}
            {g.items.map((it) => {
              const active =
                it.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`nav-link ${active ? "active" : ""}`}
                  style={{ position: "relative" }}
                >
                  <it.Icon
                    width={17}
                    height={17}
                    style={{ opacity: active ? 1 : 0.7, flex: "none" }}
                  />
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ marginTop: "auto" }} />

      {/* System status */}
      <Link
        href="/account"
        className="card"
        style={{ padding: "11px 13px", background: "var(--panel-2)", display: "block" }}
      >
        <StatusRow
          ok={authOk}
          title={
            usingKey ? "API key activa" : authOk ? "Suscripción activa" : "No autenticado"
          }
          sub={
            usingKey
              ? "Anthropic API key"
              : authOk
                ? `${auth?.email ?? ""}${auth?.subscriptionType ? ` · ${auth.subscriptionType}` : ""}`
                : "Configura tu modelo/auth →"
          }
        />
        <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />
        <StatusRow
          ok={schedOk}
          neutralOff
          title={`Scheduler ${schedOk ? "activo" : "detenido"}`}
          sub={
            status
              ? `${status.scheduler.activeRuns} corriendo · ${status.counts.pendingTasks} pendientes`
              : "cargando…"
          }
        />
      </Link>
    </aside>
  );
}

function StatusRow({
  ok,
  title,
  sub,
  neutralOff,
}: {
  ok: boolean;
  title: string;
  sub: string;
  neutralOff?: boolean;
}) {
  const color = ok ? "var(--ok)" : neutralOff ? "var(--muted)" : "var(--danger)";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className={ok ? "live-dot" : ""}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: color,
            color,
            display: "inline-block",
            flex: "none",
          }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
      </div>
      <div
        className="muted"
        style={{
          fontSize: 11,
          marginTop: 4,
          paddingLeft: 16,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {sub}
      </div>
    </div>
  );
}
