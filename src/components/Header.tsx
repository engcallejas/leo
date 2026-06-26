export function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 22,
        gap: 16,
      }}
    >
      <div>
        <h1
          className="ed-display"
          style={{ fontSize: 27, fontWeight: 500, margin: 0, letterSpacing: "-0.015em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}
