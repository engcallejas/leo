"use client";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function ErrorBar({ text }: { text: string }) {
  return (
    <div
      className="card badge-danger"
      style={{ padding: "9px 12px", marginBottom: 14, fontSize: 13 }}
    >
      {text}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "start center",
        padding: "48px 16px",
        zIndex: 50,
        overflow: "auto",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, padding: 22 }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 16,
            marginBottom: 18,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          {title}
          <button
            className="btn btn-sm"
            onClick={onClose}
            style={{ border: "none", background: "transparent" }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
