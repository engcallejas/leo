import type { Project, Task } from "../types";

/**
 * Compose the full instruction handed to `claude -p`. The repo's own CLAUDE.md
 * and .mcp.json are picked up automatically by the CLI (cwd = repo), so this
 * prompt focuses on the task, the project rules, and the finalization contract.
 */
export function buildPrompt(project: Project, task: Task): string {
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

  if (project.prompt_rules.trim()) {
    sections.push(
      `\n## Project rules (can / must / must-not)`,
      project.prompt_rules.trim(),
    );
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
