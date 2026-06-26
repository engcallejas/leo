"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client";
import { ImageAttach, imageFilesFromPaste } from "@/components/ImageAttach";
import { SectionHeader } from "@/components/Section";
import { IconIterate } from "@/components/icons";
import type { Run } from "@/lib/types";

type PrMode = "commit" | "new_pr";

/**
 * "Next iteration" action for a FINISHED run. Resumes the run's exact Claude
 * session (full memory) and applies the human's follow-up fix; with "compactar
 * antes" it distills the session into a summary first and starts fresh from it.
 */
export function RunIterate({ run }: { run: Run }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [compact, setCompact] = useState(false);
  const [prMode, setPrMode] = useState<PrMode>("commit");
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only finished runs can be iterated.
  if (run.status === "running") return null;

  const launch = async () => {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("instruction", text);
      form.set("compact", compact ? "1" : "0");
      form.set("prMode", prMode);
      for (const f of images) form.append("file", f);
      const next: Run = await api.postForm(`/api/runs/${run.id}/iterate`, form);
      router.push(`/runs/${next.id}`);
    } catch (e) {
      setError((e as Error).message || "No se pudo lanzar la iteración.");
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ padding: 18, marginBottom: 18 }}>
      <SectionHeader
        icon={<IconIterate />}
        accent="var(--accent)"
        title="Siguiente iteración"
        desc="El agente reanuda su sesión exacta (memoria completa: branch, PR, decisiones) y aplica el ajuste que le pidas. Hereda el buzón de notas para seguir corrigiéndolo."
      />

      <textarea
        className="textarea"
        placeholder="¿Qué ajustar en esta iteración? Ej. “Ya se aplicaron las migraciones, pero la automatización del cálculo de fechas no funcionó.”"
        value={instruction}
        disabled={busy}
        onChange={(e) => setInstruction(e.target.value)}
        onPaste={(e) => {
          const imgs = imageFilesFromPaste(e);
          if (imgs.length) {
            e.preventDefault();
            setImages((prev) => [...prev, ...imgs]);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) launch();
        }}
        style={{ width: "100%", minHeight: 80, fontFamily: "inherit", fontSize: 13 }}
      />

      <div style={{ marginTop: 10 }}>
        <ImageAttach files={images} onChange={setImages} disabled={busy} />
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          margin: "16px 0",
        }}
      >
        <div>
          <div className="label" style={{ marginBottom: 7 }}>
            Al terminar
          </div>
          <div className="seg" role="group" aria-label="Acción al terminar">
            {(
              [
                ["commit", "Commit a la branch"],
                ["new_pr", "Crear PR nuevo"],
              ] as [PrMode, string][]
            ).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                className="seg-btn"
                aria-pressed={prMode === val}
                disabled={busy}
                onClick={() => setPrMode(val)}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 7 }}>
            {prMode === "new_pr"
              ? "Abre un PR nuevo (branch nueva); no toca el anterior."
              : "Commit + push a la misma branch; el PR existente se actualiza solo."}
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: 7 }}>
            Contexto
          </div>
          <label
            style={{
              display: "flex",
              gap: 9,
              alignItems: "flex-start",
              fontSize: 12.5,
              cursor: busy ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={compact}
              disabled={busy}
              onChange={(e) => setCompact(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong style={{ fontWeight: 600 }}>Compactar antes</strong>
              <span className="muted">
                {" "}
                — destila la sesión y arranca fresco. Más liviano y barato; pierde
                memoria fina. Útil si la sesión es muy larga.
              </span>
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div
          className="badge badge-danger"
          style={{
            display: "block",
            padding: "9px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          className="btn btn-primary"
          onClick={launch}
          disabled={busy || !instruction.trim()}
          title="⌘/Ctrl + Enter"
        >
          {busy
            ? compact
              ? "Compactando y lanzando…"
              : "Lanzando…"
            : "Lanzar iteración"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {busy && compact
            ? "Resumiendo la sesión, puede tardar…"
            : "⌘/Ctrl + Enter"}
        </span>
      </div>
    </section>
  );
}
