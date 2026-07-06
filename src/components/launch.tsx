"use client";

import { useCallback, useState } from "react";
import { api } from "@/components/client";
import { Modal } from "@/components/ui";

interface ExecState {
  busy: boolean;
  running_run_id: number | null;
  max_concurrent: number;
  /** Whether the repo is a git repo — worktrees are only possible when true. */
  git: boolean;
}

export type LaunchMode = "plain" | "worktree";

/**
 * Guard a manual launch: if the project already has a run in flight, ask whether
 * to isolate this one in a git worktree (parallel, no clobber) or run it anyway.
 * Resolves immediately to "plain" when the project is free — no dialog. With more
 * than one concurrent run configured, worktree is the default/emphasized choice.
 *
 *   const { guard, dialog } = useLaunchGuard();
 *   const mode = await guard(projectId);
 *   if (mode === null) return;               // cancelled
 *   await api.post(url, { worktree: mode === "worktree" });
 *   ...render {dialog} once in the tree.
 */
export function useLaunchGuard() {
  const [state, setState] = useState<{
    exec: ExecState;
    resolve: (v: LaunchMode | null) => void;
  } | null>(null);

  const guard = useCallback(
    async (projectId: number): Promise<LaunchMode | null> => {
      let exec: ExecState;
      try {
        exec = await api.get(`/api/projects/${projectId}/exec-state`);
      } catch {
        return "plain"; // preflight failed → don't block the user
      }
      if (!exec.busy) return "plain";
      return new Promise<LaunchMode | null>((resolve) =>
        setState({ exec, resolve }),
      );
    },
    [],
  );

  const settle = (v: LaunchMode | null) =>
    setState((s) => {
      s?.resolve(v);
      return null;
    });

  const dialog = state ? (
    <LaunchGuardDialog exec={state.exec} onChoose={settle} />
  ) : null;

  return { guard, dialog };
}

function LaunchGuardDialog({
  exec,
  onChoose,
}: {
  exec: ExecState;
  onChoose: (v: LaunchMode | null) => void;
}) {
  const canWorktree = exec.git;
  const defaultWorktree = canWorktree && exec.max_concurrent > 1;
  return (
    <Modal title="Ya hay una ejecución en curso" onClose={() => onChoose(null)}>
      <div
        style={{
          fontSize: 13.5,
          color: "var(--muted)",
          lineHeight: 1.6,
          marginBottom: 20,
        }}
      >
        Este proyecto ya tiene una ejecución en curso
        {exec.running_run_id != null ? ` (ejecución #${exec.running_run_id})` : ""}.{" "}
        {canWorktree ? (
          <>
            Puedes lanzar esta como <strong>worktree</strong> — una copia aislada
            del repositorio en su propia branch, para correr en paralelo sin
            chocar con la ejecución actual — o ejecutarla de todos modos sobre el
            mismo directorio (puede interferir con la que ya está corriendo).
            {defaultWorktree
              ? " Tienes más de una ejecución concurrente configurada, así que el worktree es la opción recomendada."
              : ""}
          </>
        ) : (
          <>
            El repositorio no es un repo git, así que no se puede aislar en un
            worktree. Si la ejecutas ahora correrá sobre el mismo directorio y
            puede interferir con la que ya está corriendo.
          </>
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button className="btn" onClick={() => onChoose(null)}>
          Cancelar
        </button>
        <button
          className={defaultWorktree ? "btn" : "btn btn-primary"}
          onClick={() => onChoose("plain")}
          autoFocus={!canWorktree}
        >
          Ejecutar de todos modos
        </button>
        {canWorktree && (
          <button
            className={defaultWorktree ? "btn btn-primary" : "btn"}
            onClick={() => onChoose("worktree")}
            autoFocus={defaultWorktree}
          >
            ⑂ Enviar como worktree
          </button>
        )}
      </div>
    </Modal>
  );
}
