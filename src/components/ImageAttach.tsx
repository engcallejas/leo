"use client";

import { type ClipboardEvent, useRef } from "react";
import { IconPaperclip } from "@/components/icons";

/**
 * Extract image File(s) from a paste event (⌘/Ctrl+V). Wire this to a textarea's
 * onPaste so users can paste screenshots straight in.
 */
export function imageFilesFromPaste(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) {
        out.push(
          f.name
            ? f
            : new File([f], `pegada-${Date.now()}.png`, {
                type: f.type || "image/png",
              }),
        );
      }
    }
  }
  return out;
}

/** Small image picker: an "attach" button plus removable filename chips. */
export function ImageAttach({
  files,
  onChange,
  disabled,
  label = "Adjuntar imagen",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        style={{ gap: 6 }}
      >
        <IconPaperclip width={14} height={14} />
        {label}
      </button>
      <span className="muted" style={{ fontSize: 11.5, marginLeft: 9 }}>
        o pégala con ⌘/Ctrl+V
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onChange([...files, ...Array.from(e.target.files)]);
          e.target.value = "";
        }}
      />
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="badge"
              style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
            >
              <IconPaperclip width={12} height={12} />
              {f.name}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Quitar ${f.name}`}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
