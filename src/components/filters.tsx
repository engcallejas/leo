"use client";

import type { ReactNode } from "react";

/** Shared date-range presets used by the board, plans and runs filter bars. */
export const DATE_PRESETS: { key: string; label: string; days: number | null }[] =
  [
    { key: "all", label: "Cualquier fecha", days: null },
    { key: "today", label: "Hoy", days: 1 },
    { key: "7d", label: "Últimos 7 días", days: 7 },
    { key: "30d", label: "Últimos 30 días", days: 30 },
  ];

/** True if an ISO/SQLite datetime falls within the last `days` (null = always). */
export function withinDate(dateStr: string, days: number | null): boolean {
  if (days == null) return true;
  const d = new Date(
    dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z",
  );
  if (Number.isNaN(d.getTime())) return true;
  return (Date.now() - d.getTime()) / 86400000 <= days;
}

/** Map a date-preset key to its window in days. */
export function presetDays(key: string): number | null {
  return DATE_PRESETS.find((d) => d.key === key)?.days ?? null;
}

/** A labelled inline select, editorial style. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span className="label" style={{ margin: 0 }}>
        {label}
      </span>
      <select
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "auto", minWidth: 130, padding: "6px 10px" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A row of filter controls with an optional right-aligned count. */
export function FilterBar({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      {children}
      {right != null && (
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {right}
        </span>
      )}
    </div>
  );
}
