import type { ReactNode } from "react";

/**
 * Consistent panel header: a tinted icon chip + title (+ optional description and
 * a right-aligned slot). Shared across the run page so steering, iteration,
 * transcript, etc. read as one system instead of ad-hoc emoji headings.
 */
export function SectionHeader({
  title,
  desc,
  icon,
  accent,
  right,
}: {
  title: string;
  desc?: ReactNode;
  icon: ReactNode;
  accent?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        marginBottom: desc ? 14 : 0,
      }}
    >
      <span className="sec-ico" style={accent ? { color: accent } : undefined}>
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className="sec-title"
          style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}
        >
          {title}
        </div>
        {desc && (
          <div
            className="muted"
            style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}
          >
            {desc}
          </div>
        )}
      </div>
      {right && <div style={{ flex: "none" }}>{right}</div>}
    </div>
  );
}
