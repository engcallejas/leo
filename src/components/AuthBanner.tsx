"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/client";
import type { AuthStatus } from "@/lib/claude-auth";

export function AuthBanner() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get("/api/auth")
        .then((a) => alive && setAuth(a))
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!auth || auth.authenticated) return null;

  const reason = auth.loggedIn
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
