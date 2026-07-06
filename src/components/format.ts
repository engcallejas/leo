import type { BoardColumn, RunStatus, TaskStatus } from "@/lib/types";

/** The board lanes in flow order, with their labels + one-line subtitles. */
export const BOARD_COLUMNS: {
  key: BoardColumn;
  label: string;
  hint: string;
}[] = [
  { key: "fuentes", label: "Fuentes", hint: "Desde las fuentes · negocio" },
  { key: "planeacion", label: "Planeación", hint: "Refinamiento técnico" },
  {
    key: "backlog",
    label: "Por desarrollar",
    hint: "Listas · estados que escuchamos",
  },
  { key: "cola", label: "Cola", hint: "Cola de trabajo" },
  { key: "ejecucion", label: "Ejecución", hint: "En progreso" },
  { key: "revision", label: "Revisión", hint: "Cerrar o iterar" },
  { key: "cerrada", label: "Cerrada", hint: "Archivada" },
];

export function boardColumnLabel(c: BoardColumn): string {
  return BOARD_COLUMNS.find((x) => x.key === c)?.label ?? c;
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "done":
      return "badge badge-ok badge-dot";
    case "failed":
      return "badge badge-danger badge-dot";
    case "running":
      return "badge badge-running badge-dot";
    case "queued":
      return "badge badge-warn badge-dot";
    case "cancelled":
      return "badge badge-danger badge-dot";
    case "pending":
    default:
      return "badge badge-dot";
  }
}

const TASK_LABELS: Record<TaskStatus, string> = {
  pending: "Pendiente",
  queued: "En cola",
  running: "Corriendo",
  done: "Hecha",
  failed: "Falló",
  skipped: "Omitida",
  cancelled: "Cancelada",
};

const RUN_LABELS: Record<RunStatus, string> = {
  running: "Corriendo",
  done: "Hecha",
  failed: "Falló",
  cancelled: "Cancelada",
};

export function taskStatusLabel(s: string): string {
  return TASK_LABELS[s as TaskStatus] ?? s;
}
export function runStatusLabel(s: string): string {
  return RUN_LABELS[s as RunStatus] ?? s;
}

const PLAN_LABELS: Record<string, string> = {
  draft: "Borrador",
  refining: "Refinando",
  refined: "Refinado",
  queued: "En cola",
  running: "Ejecutando",
  dispatched: "En desarrollo (ClickUp)",
  done: "Completado",
  failed: "Falló",
  cancelled: "Cancelado",
};
const PLAN_STEP_LABELS: Record<string, string> = {
  pending: "Pendiente",
  queued: "En cola",
  running: "Corriendo",
  done: "Hecho",
  failed: "Falló",
  skipped: "Omitido",
};
export function planStatusLabel(s: string): string {
  return PLAN_LABELS[s] ?? s;
}
export function planStepStatusLabel(s: string): string {
  return PLAN_STEP_LABELS[s] ?? s;
}
export function planStatusBadgeClass(s: string): string {
  switch (s) {
    case "done":
      return "badge badge-ok badge-dot";
    case "failed":
    case "cancelled":
      return "badge badge-danger badge-dot";
    case "running":
    case "refining":
    case "dispatched":
      return "badge badge-running badge-dot";
    case "queued":
    case "refined":
      return "badge badge-warn badge-dot";
    default:
      return "badge badge-dot";
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(secs)) return iso;
  if (secs < 60) return `hace ${secs}s`;
  if (secs < 3600) return `hace ${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `hace ${Math.floor(secs / 3600)}h`;
  return `hace ${Math.floor(secs / 86400)}d`;
}

export function fmtCost(usd: number | null): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(3)}`;
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
