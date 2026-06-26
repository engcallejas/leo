"use client";

import { useCallback, useRef, useState } from "react";

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

/**
 * Confirmation dialog. Modals in Leo are reserved for confirmations/alerts
 * (never forms). Prefer the `useConfirm()` hook for an await-able API.
 */
export interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger,
  onConfirm,
  onCancel,
}: ConfirmOpts & { onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      {body && (
        <div
          style={{
            fontSize: 13.5,
            color: "var(--muted)",
            lineHeight: 1.55,
            marginBottom: 22,
          }}
        >
          {body}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          className={danger ? "btn btn-danger" : "btn btn-primary"}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Await-able confirmation. Usage:
 *   const { confirm, dialog } = useConfirm();
 *   ...if (!(await confirm({ title, body, danger: true }))) return;
 *   ...render {dialog} once in the component tree.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    opts: ConfirmOpts;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const settle = (v: boolean) =>
    setState((s) => {
      s?.resolve(v);
      return null;
    });

  const dialog = state ? (
    <ConfirmDialog
      {...state.opts}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog };
}

/**
 * Right slide-in drawer for detail + inline editing (the board's card facets).
 * Modals stay reserved for confirmations; rich surfaces live in a drawer.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ed-display" style={{ fontSize: 18, lineHeight: 1.3 }}>
              {title}
            </div>
            {subtitle && (
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            className="btn btn-sm"
            onClick={onClose}
            style={{ border: "none", background: "transparent" }}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * Transient toast for action feedback / illegal-drop notices.
 *   const { show, toast } = useToast();
 *   show("Encolada"); show("No permitido", true);
 *   ...render {toast} once in the tree.
 */
export function useToast() {
  const [state, setState] = useState<{ text: string; err: boolean } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, err = false) => {
    setState({ text, err });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 3200);
  }, []);
  const toast = state ? (
    <div className={`toast ${state.err ? "err" : ""}`}>{state.text}</div>
  ) : null;
  return { show, toast };
}
