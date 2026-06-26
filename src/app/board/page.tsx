"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { api } from "@/components/client";
import { CardDrawer, type CardAction } from "@/components/CardDrawer";
import {
  BOARD_COLUMNS,
  planStatusBadgeClass,
  planStatusLabel,
  statusBadgeClass,
  taskStatusLabel,
} from "@/components/format";
import { Header } from "@/components/Header";
import {
  DATE_PRESETS,
  FilterSelect,
  presetDays,
  withinDate,
} from "@/components/filters";
import { Drawer, ErrorBar, useConfirm, useToast } from "@/components/ui";
import type { BoardCard, BoardColumn, Project } from "@/lib/types";

/**
 * Free movement: a card can be dragged to ANY column. canMove only flags the
 * genuinely-impossible drops (a plan can't become a raw source item; a plan with
 * no steps can't enter the work queue). Everything else is allowed and mapped to
 * the right operation in doMove.
 */
function canMove(card: BoardCard, target: BoardColumn): { illegal?: string } {
  if (card.kind === "plan") {
    if (target === "fuentes")
      return { illegal: "Un plan no puede volver a Fuentes." };
    if (
      target === "cola" &&
      card.status !== "refined" &&
      !(card.steps_total && card.steps_total > 0)
    )
      return { illegal: "Refina el plan primero (genera pasos)." };
  }
  return {};
}

const SRC_LABEL: Record<string, string> = {
  clickup: "ClickUp",
  sentry: "Sentry",
  manual: "Manual",
};

export default function BoardPage() {
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sourceF, setSourceF] = useState<string>("all");
  const [dateF, setDateF] = useState<string>("all");

  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<BoardColumn | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);

  const { confirm, dialog } = useConfirm();
  const { show, toast } = useToast();

  // Keep refs so the polling loop can pause without re-creating the interval.
  const pause = useRef(false);
  pause.current = !!(draggingKey || selectedKey || busyKey);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      api.get("/api/board"),
      api.get("/api/projects"),
    ]);
    setCards(c);
    setProjects(p);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => {
      if (!pause.current) load().catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [load]);

  const draggingCard = draggingKey
    ? cards.find((c) => c.key === draggingKey) ?? null
    : null;
  const selectedCard = selectedKey
    ? cards.find((c) => c.key === selectedKey) ?? null
    : null;

  const doAction = useCallback(
    async (card: BoardCard, action: CardAction) => {
      if (action === "run") {
        const ok = await confirm({
          title: "Ejecutar ahora",
          body: "Esto iniciará una ejecución real de Claude sobre el repositorio del proyecto. ¿Continuar?",
          confirmLabel: "Ejecutar",
        });
        if (!ok) return;
      }
      if (action === "cancel") {
        const ok = await confirm({
          title: "Devolver a planeación",
          body: "Se cancela la orquestación en curso y el plan vuelve a “refinado”. ¿Continuar?",
          confirmLabel: "Cancelar orquestación",
          danger: true,
        });
        if (!ok) return;
      }
      if (action === "delete") {
        const ok = await confirm({
          title: card.kind === "plan" ? "Eliminar plan" : "Eliminar tarea",
          body: `Se elimina “${card.title.slice(0, 70)}” de Leo de forma permanente. ${
            card.kind === "task"
              ? "Si proviene de una fuente activa, podría volver a aparecer en el próximo sondeo."
              : "Se detiene si está refinando o ejecutando."
          }`,
          confirmLabel: "Eliminar",
          danger: true,
        });
        if (!ok) return;
      }
      setBusyKey(card.key);
      try {
        let msg = "";
        switch (action) {
          case "promote":
            await api.post(`/api/projects/${card.project_id}/plans`, {
              from_task_id: card.id,
            });
            msg = "Promovida a planeación";
            break;
          case "refine":
            await api.post(`/api/plans/${card.id}/refine`);
            msg = "Refinando…";
            break;
          case "enqueue":
            if (card.kind === "plan")
              await api.post(`/api/plans/${card.id}/enqueue`, {});
            else await api.post(`/api/tasks/${card.id}/queue`, {});
            msg = "En cola";
            break;
          case "run":
            if (card.kind === "plan") {
              await api.post("/api/poll");
              msg = "Ejecución en marcha (scheduler)";
            } else {
              const r = await api.post(`/api/tasks/${card.id}/run`);
              msg = r?.started ? "Ejecución iniciada" : r?.queued ? "En cola" : "Solicitada";
            }
            break;
          case "cancel":
            await api.post(`/api/plans/${card.id}/cancel`, {});
            msg = "Devuelta a planeación";
            break;
          case "close":
            if (card.kind === "plan")
              await api.post(`/api/plans/${card.id}/close`, {});
            else await api.post(`/api/tasks/${card.id}/close`, {});
            msg = "Cerrada";
            break;
          case "reopen":
            if (card.kind === "plan")
              await api.post(`/api/plans/${card.id}/close`, { closed: false });
            else await api.post(`/api/tasks/${card.id}/close`, { closed: false });
            msg = "Reabierta";
            break;
          case "discard":
            await api.post(`/api/tasks/${card.id}/skip`);
            msg = "Descartada";
            break;
          case "delete":
            if (card.kind === "plan") await api.del(`/api/plans/${card.id}`);
            else await api.del(`/api/tasks/${card.id}`);
            msg = "Eliminada";
            break;
        }
        show(msg);
        setSelectedKey(null); // structural move → close the drawer
        await load();
      } catch (e) {
        show((e as Error).message, true);
      } finally {
        setBusyKey(null);
      }
    },
    [confirm, load, show],
  );

  // Free drag-between-columns: map any target column to the right operation.
  const doMove = useCallback(
    async (card: BoardCard, target: BoardColumn) => {
      if (target === "ejecucion") {
        const ok = await confirm({
          title: "Ejecutar ahora",
          body: "Iniciará una ejecución real de Claude sobre el repositorio del proyecto. ¿Continuar?",
          confirmLabel: "Ejecutar",
        });
        if (!ok) return;
      }
      if (
        card.kind === "plan" &&
        target === "planeacion" &&
        (card.status === "running" || card.status === "queued")
      ) {
        const ok = await confirm({
          title: "Devolver a planeación",
          body: "Se cancela la orquestación en curso y el plan vuelve a “refinado”. ¿Continuar?",
          confirmLabel: "Cancelar orquestación",
          danger: true,
        });
        if (!ok) return;
      }
      setBusyKey(card.key);
      try {
        let msg = "";
        if (card.kind === "task") {
          switch (target) {
            case "fuentes":
              await api.post(`/api/tasks/${card.id}/status`, {
                status: "pending",
                closed: false,
              });
              msg = "Devuelta a Fuentes";
              break;
            case "planeacion":
              await api.post(`/api/projects/${card.project_id}/plans`, {
                from_task_id: card.id,
              });
              msg = "Promovida a planeación";
              break;
            case "cola":
              await api.post(`/api/tasks/${card.id}/queue`, {});
              msg = "En cola";
              break;
            case "ejecucion": {
              const r = await api.post(`/api/tasks/${card.id}/run`);
              msg = r?.started
                ? "Ejecución iniciada"
                : r?.queued
                  ? "En cola"
                  : "Solicitada";
              break;
            }
            case "revision":
              await api.post(`/api/tasks/${card.id}/status`, {
                status: "done",
                closed: false,
              });
              msg = "Marcada como hecha";
              break;
            case "cerrada":
              await api.post(`/api/tasks/${card.id}/close`, {});
              msg = "Cerrada";
              break;
          }
        } else {
          switch (target) {
            case "planeacion":
              if (card.status === "running" || card.status === "queued")
                await api.post(`/api/plans/${card.id}/cancel`, {});
              else
                await api.post(`/api/plans/${card.id}/status`, {
                  status: "refined",
                  closed: false,
                });
              msg = "En planeación";
              break;
            case "cola":
              if (card.status === "refined")
                await api.post(`/api/plans/${card.id}/enqueue`, {});
              else
                await api.post(`/api/plans/${card.id}/status`, {
                  status: "queued",
                  closed: false,
                });
              msg = "En cola";
              break;
            case "ejecucion":
              await api.post("/api/poll");
              msg = "Ejecución en marcha (scheduler)";
              break;
            case "revision":
              await api.post(`/api/plans/${card.id}/status`, {
                status: "done",
                closed: false,
              });
              msg = "Marcado como hecho";
              break;
            case "cerrada":
              await api.post(`/api/plans/${card.id}/close`, {});
              msg = "Cerrado";
              break;
          }
        }
        show(msg);
        setSelectedKey(null);
        await load();
      } catch (e) {
        show((e as Error).message, true);
      } finally {
        setBusyKey(null);
      }
    },
    [confirm, load, show],
  );

  const syncSources = async () => {
    setSyncing(true);
    try {
      const r = await api.post("/api/poll");
      const pruned = r?.pruned ?? 0;
      show(
        `Sincronizado · ${r?.sourcesPolled ?? 0} fuentes · ${r?.started ?? 0} iniciadas${
          pruned ? ` · ${pruned} eliminadas` : ""
        }`,
      );
      await load();
    } catch (e) {
      show((e as Error).message, true);
    } finally {
      setSyncing(false);
    }
  };

  const onDrop = (target: BoardColumn) => {
    const card = draggingCard;
    setOverCol(null);
    setDraggingKey(null);
    if (!card || card.column === target) return;
    const chk = canMove(card, target);
    if (chk.illegal) {
      show(chk.illegal, true);
      return;
    }
    void doMove(card, target);
  };

  // Apply filters once. (The board is already scoped to the active project.)
  const visible = useMemo(() => {
    const days = presetDays(dateF);
    return cards.filter((c) => {
      if (sourceF !== "all" && c.source_type !== sourceF) return false;
      if (!withinDate(c.date, days)) return false;
      return true;
    });
  }, [cards, sourceF, dateF]);

  const byColumn = (col: BoardColumn) => visible.filter((c) => c.column === col);

  return (
    <div
      style={{
        maxWidth: 1480,
        margin: "0 auto",
        height: "calc(100vh - 56px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header
        title="Tablero"
        subtitle="El ciclo completo: fuentes → planeación → cola → ejecución → revisión → cerrada"
        right={
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={syncSources} disabled={syncing}>
              {syncing ? "Sincronizando…" : "Sincronizar fuentes"}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              + Nueva tarea
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <FilterSelect
          label="Fuente"
          value={sourceF}
          onChange={setSourceF}
          options={[
            { value: "all", label: "Todas" },
            { value: "clickup", label: "ClickUp" },
            { value: "sentry", label: "Sentry" },
            { value: "manual", label: "Manual" },
          ]}
        />
        <FilterSelect
          label="Fecha"
          value={dateF}
          onChange={setDateF}
          options={DATE_PRESETS.map((d) => ({ value: d.key, label: d.label }))}
        />
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {visible.length} de {cards.length} tarjetas
        </span>
      </div>

      {/* Board */}
      <div className="board" style={{ flex: 1, minHeight: 0 }}>
        {BOARD_COLUMNS.map((col) => {
          const colCards = byColumn(col.key);
          const isOver = draggingCard && overCol === col.key;
          const sameCol = draggingCard?.column === col.key;
          let dropCls = "";
          if (isOver && draggingCard && !sameCol) {
            dropCls = canMove(draggingCard, col.key).illegal
              ? " drop-deny"
              : " drop-ok";
          }
          return (
            <div
              key={col.key}
              className={`board-col${dropCls}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.key) setOverCol(col.key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(col.key);
              }}
            >
              <div className="board-col-head">
                <span className="board-col-title">{col.label}</span>
                <span className="board-col-count">{colCards.length}</span>
              </div>
              <div className="board-col-hint">{col.hint}</div>
              <div className="board-col-body">
                {colCards.length === 0 ? (
                  <div className="board-empty">—</div>
                ) : (
                  colCards.map((c) => (
                    <Card
                      key={c.key}
                      card={c}
                      dragging={draggingKey === c.key}
                      onDragStart={() => setDraggingKey(c.key)}
                      onDragEnd={() => {
                        setDraggingKey(null);
                        setOverCol(null);
                      }}
                      onClick={() => setSelectedKey(c.key)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedCard && (
        <CardDrawer
          card={selectedCard}
          onClose={() => setSelectedKey(null)}
          onAction={doAction}
          onChanged={() => load().catch(() => {})}
          show={show}
        />
      )}
      {creating && (
        <NewTaskDrawer
          projects={projects}
          onClose={() => setCreating(false)}
          onCreated={(m) => {
            show(m);
            setCreating(false);
            load().catch(() => {});
          }}
        />
      )}
      {dialog}
      {toast}
    </div>
  );
}

function NewTaskDrawer({
  projects,
  onClose,
  onCreated,
}: {
  projects: Project[];
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const { activeProjectId } = useAccount();
  const [projectId, setProjectId] = useState(
    activeProjectId != null
      ? String(activeProjectId)
      : projects[0]?.id != null
        ? String(projects[0].id)
        : "",
  );
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!projectId || !title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/tasks", {
        project_id: Number(projectId),
        title: title.trim(),
        description: desc,
      });
      onCreated("Tarea creada");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="Nueva tarea"
      subtitle="Se añade a Fuentes, lista para refinar o ejecutar"
      onClose={onClose}
    >
      <div>
        <label className="label">Proyecto</label>
        <select
          className="select"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projects.length === 0 && <option value="">(sin proyectos)</option>}
          {projects.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Título</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Qué hay que hacer"
          autoFocus
        />
      </div>
      <div>
        <label className="label">Descripción</label>
        <textarea
          className="textarea"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Detalle, contexto, criterios de aceptación…"
          style={{ minHeight: 140 }}
        />
      </div>
      {err && <ErrorBar text={err} />}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn btn-primary"
          onClick={create}
          disabled={!projectId || !title.trim() || busy}
        >
          {busy ? "Creando…" : "Crear tarea"}
        </button>
      </div>
    </Drawer>
  );
}

function Card({
  card,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  card: BoardCard;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const badgeClass =
    card.kind === "plan"
      ? planStatusBadgeClass(card.status)
      : statusBadgeClass(card.status);
  const label =
    card.kind === "plan"
      ? planStatusLabel(card.status)
      : taskStatusLabel(card.status);
  return (
    <div
      className={`board-card${card.failed ? " failed" : ""}${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="board-card-title">{card.title}</div>
      <div className="board-card-foot">
        <span className="board-src">{SRC_LABEL[card.source_type] ?? card.source_type}</span>
        <span className="board-card-proj" style={{ flex: 1 }}>
          {card.project_name}
        </span>
        <span
          className={badgeClass}
          style={{ padding: "1px 7px", fontSize: 10.5, flex: "none" }}
        >
          {label}
        </span>
      </div>
      {card.sub && <div className="board-card-sub" style={{ marginTop: 6 }}>{card.sub}</div>}
    </div>
  );
}

