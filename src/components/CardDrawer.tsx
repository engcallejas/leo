"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/client";
import {
  planStatusBadgeClass,
  planStatusLabel,
  planStepStatusLabel,
  statusBadgeClass,
  taskStatusLabel,
  timeAgo,
} from "@/components/format";
import { IconLink } from "@/components/icons";
import { ImageAttach, imageFilesFromPaste } from "@/components/ImageAttach";
import { Markdown } from "@/components/Markdown";
import { PlanAttachments } from "@/components/PlanAttachments";
import { Drawer } from "@/components/ui";
import type { BoardCard } from "@/lib/types";

const SRC_LABEL: Record<string, string> = {
  clickup: "ClickUp",
  sentry: "Sentry",
  manual: "Manual",
};

export type CardAction =
  | "promote"
  | "enqueue"
  | "run"
  | "cancel"
  | "close"
  | "reopen"
  | "discard"
  | "refine"
  | "delete";

interface TaskDetail {
  id: number;
  title: string;
  description: string;
  url: string | null;
  status: string;
  source_type: string;
  integration_id: number | null;
  scheduled_for: string | null;
  raw?: { list?: { id?: string } } | null;
}

interface PlanStepLite {
  id: number;
  title: string;
  status: string;
  position: number;
}
interface PlanDetail {
  id: number;
  title: string;
  objective: string;
  status: string;
  source_url: string | null;
  error: string | null;
  steps?: PlanStepLite[];
}

export function CardDrawer({
  card,
  onClose,
  onAction,
  onChanged,
  show,
}: {
  card: BoardCard;
  onClose: () => void;
  onAction: (card: BoardCard, action: CardAction) => void | Promise<void>;
  onChanged: () => void;
  show: (msg: string, err?: boolean) => void;
}) {
  const subtitle = (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="board-src">{SRC_LABEL[card.source_type] ?? card.source_type}</span>
      {card.project_name}
      {card.source_url && (
        <a
          href={card.source_url}
          target="_blank"
          rel="noreferrer"
          className="muted"
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <IconLink width={13} height={13} /> fuente
        </a>
      )}
    </span>
  );

  return (
    <Drawer title={card.title} subtitle={subtitle} onClose={onClose}>
      {card.kind === "task" ? (
        <TaskFacet card={card} onAction={onAction} onChanged={onChanged} show={show} />
      ) : (
        <PlanFacet card={card} onAction={onAction} show={show} />
      )}
    </Drawer>
  );
}

/* ------------------------------ task facet ------------------------------ */

function TaskFacet({
  card,
  onAction,
  onChanged,
  show,
}: {
  card: BoardCard;
  onAction: (card: BoardCard, action: CardAction) => void | Promise<void>;
  onChanged: () => void;
  show: (msg: string, err?: boolean) => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [imgs, setImgs] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const readonly = card.source_type === "sentry";
  const isClickup = card.source_type === "clickup";

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t: TaskDetail = await api.get(`/api/tasks/${card.id}`);
        if (!alive) return;
        setTask(t);
        setTitle(t.title);
        setDesc(t.description ?? "");
        // ClickUp: try to load the list's statuses for a real dropdown.
        const listId = t.raw?.list?.id;
        if (isClickup && t.integration_id != null && listId) {
          const s: string[] = await api
            .get(`/api/integrations/${t.integration_id}/statuses?listId=${listId}`)
            .catch(() => []);
          if (alive) setStatuses(Array.isArray(s) ? s : []);
        }
      } catch {
        /* leave card.title */
      }
    })();
    return () => {
      alive = false;
    };
  }, [card.id, isClickup]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/tasks/${card.id}/sync-source`, {
        title,
        description: desc,
        status: status || undefined,
      });
      if (res?.synced && res.synced.ok === false) {
        show(res.synced.message, true);
      } else if (res?.synced) {
        show("Guardado y sincronizado con la fuente");
      } else {
        show("Cambios guardados");
      }
      onChanged();
    } catch (e) {
      show((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const uploadImages = async () => {
    if (imgs.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      imgs.forEach((f, i) => fd.append("file", f, f.name || `pegada-${i}.png`));
      const res = await api.postForm(`/api/tasks/${card.id}/attachments`, fd);
      show(
        res?.ok
          ? `${imgs.length} imagen(es) subida(s) a ClickUp`
          : "Algunas imágenes no se pudieron subir",
        !res?.ok,
      );
      setImgs([]);
    } catch (e) {
      show((e as Error).message, true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {card.column === "fuentes" && (
        <section>
          <label className="label">Título</label>
          <input
            className="input"
            value={title}
            disabled={readonly || busy}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="label" style={{ marginTop: 12 }}>
            Descripción
          </label>
          <textarea
            className="textarea"
            value={desc}
            disabled={readonly || busy}
            onChange={(e) => setDesc(e.target.value)}
            onPaste={(e) => {
              const f = imageFilesFromPaste(e);
              if (f.length && isClickup) {
                e.preventDefault();
                setImgs((prev) => [...prev, ...f]);
              }
            }}
            style={{ minHeight: 130 }}
          />
          {isClickup && statuses.length > 0 && (
            <>
              <label className="label" style={{ marginTop: 12 }}>
                Estado en ClickUp
              </label>
              <select
                className="select"
                value={status}
                disabled={busy}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">(sin cambiar)</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </>
          )}
          {readonly && (
            <div className="hint" style={{ marginTop: 10 }}>
              Los issues de Sentry son de solo lectura; no se editan desde aquí.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn" onClick={save} disabled={readonly || busy}>
              {isClickup ? "Guardar y sincronizar" : "Guardar cambios"}
            </button>
          </div>

          {isClickup && (
            <div style={{ marginTop: 16 }}>
              <label className="label">Imágenes a la fuente (ClickUp)</label>
              <ImageAttach
                files={imgs}
                onChange={setImgs}
                disabled={uploading}
                label="Adjuntar imagen"
              />
              {imgs.length > 0 && (
                <button
                  className="btn btn-sm"
                  style={{ marginTop: 8 }}
                  disabled={uploading}
                  onClick={uploadImages}
                >
                  {uploading ? "Subiendo…" : `Subir ${imgs.length} a ClickUp`}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {card.column === "fuentes" && (
        <div style={{ height: 1, background: "var(--border)" }} />
      )}

      {/* Stage actions */}
      <section style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {card.column === "fuentes" && (
          <>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onAction(card, "promote")}
            >
              Promover a planeación
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => onAction(card, "enqueue")}
            >
              Encolar para ejecutar
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => onAction(card, "discard")}
            >
              Descartar (no ejecutar)
            </button>
          </>
        )}
        {card.column === "cola" && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onAction(card, "run")}
          >
            Ejecutar ahora
          </button>
        )}
        {card.column === "ejecucion" && card.run_id && (
          <Link className="btn" href={`/runs/${card.run_id}`}>
            Ver ejecución →
          </Link>
        )}
        {card.column === "revision" && (
          <>
            {card.run_id && (
              <Link className="btn" href={`/runs/${card.run_id}`}>
                Ver ejecución / iterar →
              </Link>
            )}
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onAction(card, "close")}
            >
              Cerrar
            </button>
          </>
        )}
        {card.column === "cerrada" && card.status !== "cancelled" && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => onAction(card, "reopen")}
          >
            Reabrir
          </button>
        )}
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => onAction(card, "delete")}
        >
          Eliminar tarea
        </button>
      </section>

      <Meta task={task} card={card} />
    </>
  );
}

function Meta({ task, card }: { task: TaskDetail | null; card: BoardCard }) {
  return (
    <div className="muted" style={{ fontSize: 11.5, display: "flex", gap: 14, flexWrap: "wrap" }}>
      <span>
        <span className={statusBadgeClass(card.status)}>
          {taskStatusLabel(card.status)}
        </span>
      </span>
      {task?.scheduled_for && <span>🕒 {new Date(task.scheduled_for).toLocaleString()}</span>}
      <span>Creada {timeAgo(card.date)}</span>
    </div>
  );
}

/* ------------------------------ plan facet ------------------------------ */

function PlanFacet({
  card,
  onAction,
  show,
}: {
  card: BoardCard;
  onAction: (card: BoardCard, action: CardAction) => void | Promise<void>;
  show: (msg: string, err?: boolean) => void;
}) {
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const p: PlanDetail = await api.get(`/api/plans/${card.id}`);
      setPlan(p);
    } catch {
      /* ignore */
    }
  }, [card.id]);

  useEffect(() => {
    load();
  }, [load]);

  const steps = plan?.steps ?? [];

  const checkClickUp = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/plans/${card.id}/sync-status`);
      show(res?.message ?? "Estado consultado");
      await load();
    } catch (e) {
      show((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Actions first — the drawer is for acting; context follows below. */}
      <div className="muted" style={{ fontSize: 11.5, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span className={planStatusBadgeClass(card.status)}>
          {planStatusLabel(card.status)}
        </span>
        {steps.length > 0 && (
          <span>
            {steps.filter((s) => s.status === "done").length}/{steps.length} pasos
          </span>
        )}
        <span>Creado {timeAgo(card.date)}</span>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {card.column === "planeacion" && (
          <>
            {card.status === "draft" && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => onAction(card, "refine")}
              >
                Refinar
              </button>
            )}
            {card.status === "refined" && (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => onAction(card, "enqueue")}
              >
                Encolar
              </button>
            )}
            <Link className="btn" href={`/plans/${card.id}`}>
              Abrir planeación →
            </Link>
          </>
        )}
        {card.column === "cola" && (
          <>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onAction(card, "run")}
            >
              Ejecutar ahora
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => onAction(card, "cancel")}
            >
              Devolver a planeación
            </button>
          </>
        )}
        {card.column === "ejecucion" && (
          <>
            {card.run_id && (
              <Link className="btn" href={`/runs/${card.run_id}`}>
                Ver ejecución →
              </Link>
            )}
            <Link className="btn" href={`/plans/${card.id}`}>
              Abrir planeación →
            </Link>
            <button
              className="btn"
              disabled={busy}
              onClick={() => onAction(card, "cancel")}
            >
              Devolver a planeación
            </button>
          </>
        )}
        {card.column === "revision" && (
          <>
            {card.status === "dispatched" && (
              <button className="btn" disabled={busy} onClick={checkClickUp}>
                Comprobar estado en ClickUp
              </button>
            )}
            {card.run_id && (
              <Link className="btn" href={`/runs/${card.run_id}`}>
                Ver ejecución / iterar →
              </Link>
            )}
            <Link className="btn" href={`/plans/${card.id}`}>
              Abrir planeación →
            </Link>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onAction(card, "close")}
            >
              Cerrar
            </button>
          </>
        )}
        {card.column === "cerrada" && (
          <>
            <Link className="btn" href={`/plans/${card.id}`}>
              Abrir planeación →
            </Link>
            {card.status !== "cancelled" && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => onAction(card, "reopen")}
              >
                Reabrir
              </button>
            )}
          </>
        )}
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => onAction(card, "delete")}
        >
          Eliminar plan
        </button>
      </section>

      {plan?.error && card.failed && (
        <section
          className="card badge-danger"
          style={{ padding: "9px 12px", fontSize: 12.5 }}
        >
          {plan.error}
        </section>
      )}

      <div style={{ height: 1, background: "var(--border)" }} />

      {plan?.objective && (
        <section>
          <div className="label">Objetivo</div>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "4px 13px",
              background: "var(--panel-2)",
            }}
          >
            <Markdown text={plan.objective} size={12.5} />
          </div>
        </section>
      )}

      {steps.length > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 8 }}>
            Pasos · {steps.filter((s) => s.status === "done").length}/{steps.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {steps.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "baseline",
                  fontSize: 12.5,
                }}
              >
                <span className="mono muted" style={{ flex: "none" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{s.title}</span>
                <span
                  className={statusBadgeClass(s.status)}
                  style={{ padding: "1px 7px", fontSize: 10.5, flex: "none" }}
                >
                  {planStepStatusLabel(s.status)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <PlanAttachments
        planId={card.id}
        clickupOrigin={card.source_type === "clickup"}
      />
    </>
  );
}
