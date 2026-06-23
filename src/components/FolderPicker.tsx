"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import { Modal } from "@/components/ui";

interface BrowseResp {
  path: string;
  parent: string | null;
  isRepo: boolean;
  entries: { name: string; path: string; isRepo: boolean }[];
  roots: string[];
  home: string;
  error: string | null;
}

export function FolderPicker({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<BrowseResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [goto, setGoto] = useState("");

  const browse = useCallback(async (p?: string) => {
    setLoading(true);
    try {
      const q = p ? `?path=${encodeURIComponent(p)}` : "";
      setData(await api.get(`/api/fs/browse${q}`));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    browse(initialPath || undefined);
  }, [browse, initialPath]);

  return (
    <Modal title="Seleccionar carpeta del repo" onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        {/* roots / shortcuts */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data?.roots.map((r) => (
            <button
              key={r}
              className="btn btn-sm"
              onClick={() => browse(r)}
              title={r}
            >
              {r === data.home ? "🏠 Home" : r}
            </button>
          ))}
        </div>

        {/* current path */}
        <div
          className="mono"
          style={{
            fontSize: 12,
            padding: "8px 10px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            wordBreak: "break-all",
          }}
        >
          {data?.path ?? "…"}
          {data?.isRepo && (
            <span className="badge badge-ok badge-dot" style={{ marginLeft: 8 }}>
              git repo
            </span>
          )}
        </div>

        {/* go to path */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder="Ir a una ruta… (/Users/tu/repos)"
            value={goto}
            onChange={(e) => setGoto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && goto.trim()) browse(goto.trim());
            }}
          />
          <button
            className="btn"
            onClick={() => goto.trim() && browse(goto.trim())}
          >
            Ir
          </button>
        </div>

        {/* listing */}
        <div
          style={{
            maxHeight: 300,
            overflow: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          {data?.parent && (
            <Row onClick={() => browse(data.parent!)} icon="↰" name=".." muted />
          )}
          {loading && (
            <div className="muted" style={{ padding: 14, fontSize: 13 }}>
              Cargando…
            </div>
          )}
          {data?.error && (
            <div
              style={{ padding: 14, fontSize: 13, color: "var(--danger)" }}
            >
              {data.error}
            </div>
          )}
          {!loading &&
            data?.entries.map((e) => (
              <Row
                key={e.path}
                onClick={() => browse(e.path)}
                icon="📁"
                name={e.name}
                badge={e.isRepo ? "git" : undefined}
              />
            ))}
          {!loading && data && data.entries.length === 0 && !data.error && (
            <div className="muted" style={{ padding: 14, fontSize: 13 }}>
              (sin subcarpetas)
            </div>
          )}
        </div>

        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
        >
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            disabled={!data}
            onClick={() => data && onSelect(data.path)}
          >
            Seleccionar esta carpeta
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Row({
  onClick,
  icon,
  name,
  badge,
  muted,
}: {
  onClick: () => void;
  icon: string;
  name: string;
  badge?: string;
  muted?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 11px",
        cursor: "pointer",
        borderBottom: "1px solid var(--border)",
        fontSize: 13,
        color: muted ? "var(--muted)" : "var(--text)",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--panel-2)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ width: 18, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </span>
      {badge && <span className="badge badge-ok badge-dot">{badge}</span>}
    </div>
  );
}
