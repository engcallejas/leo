import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AccountProvider } from "@/components/AccountProvider";
import { AuthBanner } from "@/components/AuthBanner";
import { Sidebar } from "@/components/Sidebar";
import { boot } from "@/lib/boot";

// Typeface system: a rounded, modern humanist sans for UI, a soft elegant serif
// for display headings, and a mono for run data / transcript. Curvy and warm —
// not sharp. Self-hosted by next/font.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

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
    <html
      lang="es"
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
    >
      <body>
        <AccountProvider>
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar />
            <main style={{ flex: 1, minWidth: 0, padding: "28px 32px" }}>
              <AuthBanner />
              {children}
            </main>
          </div>
        </AccountProvider>
      </body>
    </html>
  );
}
