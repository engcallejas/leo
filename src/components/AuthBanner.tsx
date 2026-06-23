"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/client";
import type { AuthStatus } from "@/lib/claude-auth";
import type { ExecConfig } from "@/lib/types";

export function AuthBanner() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [exec, setExec] = useState<ExecConfig | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [a, e] = await Promise.all([
          api.get("/api/auth"),
          api.get("/api/exec"),
        ]);
        if (alive) {
          setAuth(a);
          setExec(e);
        }
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!auth || !exec) return null;
  // API-key mode with a key set → runs work, no subscription needed.
  if (exec.method === "api-key" && exec.apiKeySet) return null;
  if (exec.method === "subscription" && auth.authenticated) return null;

  const reason =
    exec.method === "api-key"
      ? "El método global es API key pero no hay ANTHROPIC_API_KEY configurada. Los runs están en pausa."
      : auth.loggedIn
        ? "Claude está autenticado por API key/consola, no por suscripción. Los runs están en pausa."
        : "No estás autenticado con una suscripción de Claude. Los runs están en pausa.";

  return (
    <div
      style={{
        background: "#241316",
        border: "1px solid #4a2730",
        color: "#fca5a5",
        borderRadius: 10,
        padding: "11px 14px",
        marginBottom: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13 }}>
        <strong style={{ color: "#fecaca" }}>⚠ Autenticación requerida.</strong>{" "}
        {reason}
      </div>
      <Link
        href="/settings"
        className="btn btn-sm"
        style={{ borderColor: "#4a2730", whiteSpace: "nowrap" }}
      >
        Configurar →
      </Link>
    </div>
  );
}
