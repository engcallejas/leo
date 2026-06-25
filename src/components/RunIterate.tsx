"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client";
import { ImageAttach, imageFilesFromPaste } from "@/components/ImageAttach";
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
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
        🔁 Iterar / Siguiente iteración
      </div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        Continúa este run terminado: el agente reanuda su sesión exacta (con toda
        su memoria —branch, PR, decisiones—) y aplica el ajuste que le pidas, sobre
        la misma branch. Hereda el buzón de notas para que sigas corrigiéndolo.
      </div>

      <textarea
        className="textarea"
        placeholder="El ajuste para esta iteración. Ej. “No uses Playwright (las migraciones no están desplegadas); cierra tras tests + CI verde y sube resultados a ClickUp.”"
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
        style={{ width: "100%", minHeight: 76, fontFamily: "inherit", fontSize: 13 }}
      />

      <div style={{ marginTop: 8 }}>
        <ImageAttach files={images} onChange={setImages} disabled={busy} />
      </div>

      <div style={{ margin: "12px 0" }}>
        <div className="label" style={{ marginBottom: 6 }}>
          Al terminar
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["commit", "Commit a la branch actual"],
              ["new_pr", "Crear PR nuevo"],
            ] as [PrMode, string][]
          ).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              className={prMode === val ? "btn btn-primary" : "btn"}
              disabled={busy}
              onClick={() => setPrMode(val)}
              style={{ fontSize: 12.5 }}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {prMode === "new_pr"
            ? "Abre un PR nuevo para esta iteración (branch nueva); no toca el PR anterior."
            : "Commit + push a la misma branch; si ya hay un PR, se actualiza solo."}
        </div>
      </div>

      <label
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          fontSize: 12.5,
          margin: "10px 0",
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
          <strong>Compactar antes</strong>{" "}
          <span className="muted">
            — destila la sesión en un resumen y arranca la iteración desde ahí
            (contexto más liviano y barato; pierde memoria fina). Útil si la
            sesión es muy larga.
          </span>
        </span>
      </label>

      {error && (
        <div
          className="badge-danger"
          style={{
            padding: "8px 11px",
            borderRadius: 8,
            fontSize: 12.5,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
        {busy && compact && (
          <span className="muted" style={{ fontSize: 12 }}>
            Esto puede tardar (estoy resumiendo la sesión)…
          </span>
        )}
      </div>
    </div>
  );
}
