import type { Project, Task } from "../types";

/** Shared-branch subtask-chain context for a step run. */
export interface ChainContext {
  branch: string;
  base: string;
  index: number; // 0-based
  total: number;
  isLast: boolean;
  priors: { title: string; summary: string }[];
}

/** The finalization bullet for an iteration, per the human's chosen PR mode. */
export function iterationFinalizeLine(prMode: "commit" | "new_pr"): string {
  return prMode === "new_pr"
    ? `- Al terminar: crea una branch NUEVA derivada del trabajo anterior y abre un PULL REQUEST NUEVO para esta iteración (no actualices el PR anterior). Asegúrate de que los checks pasen.`
    : `- Al terminar: haz commit y push a la MISMA branch del trabajo anterior. NO abras un PR nuevo — si ya existe uno para esa branch, se actualizará solo.`;
}

/**
 * Lean follow-up turn for a RESUMED iteration. The agent already carries the
 * full memory of the previous run (task, rules, branch, PR, validations), so we
 * only hand it the new human ask plus a short reminder of how to land it.
 */
export function buildIterationPrompt(
  project: Project,
  task: Task,
  instruction: string,
  prevRunId: number,
  prMode: "commit" | "new_pr",
  attachmentBlock = "",
): string {
  return [
    `Esta es una NUEVA ITERACIÓN de tu trabajo anterior en la tarea "${task.title}" (run #${prevRunId}). Ya completaste una pasada —con su commit/branch/PR— y conservas todo ese contexto.`,
    ``,
    `## Ajuste pedido por el humano (esta iteración)`,
    instruction.trim() || "(sin instrucción — revisa y mejora lo pendiente del run anterior)",
    attachmentBlock ? `\n${attachmentBlock}` : "",
    ``,
    `## Cómo continuar`,
    `- Aplica SOLO este ajuste, construyendo sobre lo ya hecho; no rehagas lo que ya estaba correcto.`,
    `- Vuelve a correr las validaciones del repo (CLAUDE.md, MCPs, tests) y déjalas en verde antes de terminar.`,
    `- Puedes recibir más correcciones del humano sobre la marcha (Leo te las inyecta automáticamente); incorpóralas.`,
    iterationFinalizeLine(prMode),
    `- Al terminar, resume QUÉ cambiaste en esta iteración y el estado del PR/branch.`,
  ].join("\n");
}

/**
 * Compose the full instruction handed to `claude -p`. The repo's own CLAUDE.md
 * and .mcp.json are picked up automatically by the CLI (cwd = repo), so this
 * prompt focuses on the task, the project rules, and the finalization contract.
 */
export function buildPrompt(
  project: Project,
  task: Task,
  extraContext = "",
  chain?: ChainContext,
): string {
  const sourceLabel =
    task.source_type === "manual"
      ? "manual"
      : task.source_type.charAt(0).toUpperCase() + task.source_type.slice(1);

  const sections: string[] = [];

  sections.push(
    `You are an autonomous engineering agent working on the "${project.name}" repository.`,
    `You were triggered by a ${sourceLabel} task. Read it, follow this repository's CLAUDE.md and existing conventions, implement the change end to end, and verify it.`,
  );

  sections.push(
    `\n## Task (source: ${sourceLabel})`,
    `Title: ${task.title}`,
    task.url ? `Link: ${task.url}` : "",
    `\nDescription:\n${task.description || "(no description provided)"}`,
  );

  if (extraContext.trim()) {
    sections.push(
      `\n## Additional context from ${sourceLabel}`,
      extraContext.trim(),
    );
  }

  if (project.prompt_rules.trim()) {
    sections.push(
      `\n## Project rules (can / must / must-not)`,
      project.prompt_rules.trim(),
    );
  }

  // When the project is interactive, the Leo MCP is available: tell the agent to
  // pull human steering notes at checkpoints so the human can course-correct it
  // mid-run without restarting.
  if (project.interactive) {
    sections.push(
      `\n## Stay in sync with the human (IMPORTANT)`,
      `The human may push you instructions WHILE you work. Call the \`mcp__leo__check_in\` tool PROACTIVELY at every checkpoint — before committing, before opening the PR, after finishing each logical chunk, and whenever you'd otherwise proceed on an assumption. It's cheap and returns instantly. If it returns new notes, incorporate them before continuing; if not, keep going.`,
    );
  }

  if (chain) {
    // Subtask N of M on a SHARED branch: progressive increments, one PR at the end.
    if (chain.priors.length) {
      sections.push(
        `\n## Subtareas previas ya completadas (en esta misma branch)`,
        `Tu trabajo CONTINÚA sobre lo ya hecho; no lo rehagas. Mantén consistencia:`,
        chain.priors
          .map(
            (p, i) =>
              `### ${i + 1}. ${p.title}\n${(p.summary || "(sin resumen)").slice(0, 1200)}`,
          )
          .join("\n\n"),
      );
    }
    const finalize: string[] = [
      `\n## Workflow & finalization (subtarea ${chain.index + 1} de ${chain.total} · branch compartida)`,
      `- Respeta el CLAUDE.md, los patrones del repo y las validaciones por MCP (Supabase, Playwright). Córrelas y déjalas en verde antes de terminar.`,
      `- Trabaja TODO sobre la branch "${chain.branch}" (base: "${chain.base}"). Si "${chain.branch}" no existe aún, créala desde "${chain.base}"; si ya existe, haz checkout y CONTINÚA sobre ella (ya trae los commits de las subtareas anteriores).`,
      `- Implementa ÚNICAMENTE esta subtarea, construyendo sobre las anteriores. No abarques las siguientes.`,
      `- Haz commit de tu incremento y push a "${chain.branch}".`,
    ];
    if (chain.isLast) {
      finalize.push(
        `- Esta es la ÚLTIMA subtarea: tras commitear, abre UN solo Pull Request desde "${chain.branch}" que cubra toda la tarea, y asegúrate de que los checks pasen.`,
      );
    } else {
      finalize.push(
        `- NO abras un Pull Request todavía — las siguientes subtareas seguirán agregando a esta misma branch. Solo commit + push.`,
      );
    }
    finalize.push(
      `- Termina con un resumen corto de lo que cambiaste y las validaciones que corriste.`,
    );
    sections.push(finalize.join("\n"));
    return sections.filter(Boolean).join("\n");
  }

  const finalize: string[] = [
    `\n## Workflow & finalization`,
    `- Respect this repository's CLAUDE.md, existing patterns, and any required MCP-based validations (e.g. Supabase, Playwright). Run them and make sure they pass before finishing.`,
    `- Make focused changes that fully address the task. Do not touch unrelated code.`,
  ];
  if (project.base_branch) {
    finalize.push(`- Base your work on the "${project.base_branch}" branch.`);
  }
  if (project.target_branch) {
    finalize.push(
      `- When done and validations pass: commit your work, push to the "${project.target_branch}" branch, and open a Pull Request. Ensure the PR checklist/steps run correctly.`,
    );
  } else {
    finalize.push(
      `- When done and validations pass: commit your work on an appropriately named branch. (No target branch configured — do not push unless the rules above say so.)`,
    );
  }
  finalize.push(
    `- End your final message with a short summary of what you changed, which validations you ran, and the PR/branch name if you created one.`,
  );
  sections.push(finalize.join("\n"));

  return sections.filter(Boolean).join("\n");
}
