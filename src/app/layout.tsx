import type { Metadata } from "next";
import "./globals.css";
import { AuthBanner } from "@/components/AuthBanner";
import { Sidebar } from "@/components/Sidebar";
import { boot } from "@/lib/boot";

export const metadata: Metadata = {
  title: "Leo — Orquestador de Claude Code",
  description: "Orquestador local de tareas para Claude Code",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fire-and-forget; idempotent. Starts the poll/run scheduler on first render.
  void boot();
  return (
    <html lang="es">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Sidebar />
          <main style={{ flex: 1, minWidth: 0, padding: "28px 32px" }}>
            <AuthBanner />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
