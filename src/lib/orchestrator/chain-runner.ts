import { getProvider } from "../integrations";
import {
  createChainChild,
  getIntegration,
  getProject,
  listChainParents,
  listChildTasks,
  listRuns,
  markChainParent,
  setTaskStatus,
} from "../repo";
import type { Integration, Project, Run, Task } from "../types";
import type { ChainContext } from "./prompt";
import { startRun } from "./runner";

const g = globalThis as unknown as { __leoChainTicking?: boolean };

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task"
  );
}

function branchFor(parent: Task): string {
  return `leo/${parent.external_id}-${slug(parent.title)}`;
}

function clickupConfig(integ: Integration): Record<string, unknown> {
  return integ.config as unknown as Record<string, unknown>;
}

/** The ClickUp status a finished chain parent should move to (its doneStatus). */
function parentDoneStatus(project: Project): string | null {
  const clickup = project.sources.filter((s) => s.type === "clickup");
  const dev =
    clickup.find((s) => s.role === "development" || s.role === "both") ??
    clickup[0];
  return (dev?.filter.doneStatus as string | undefined) ?? null;
}

async function fetchSubtasks(
  parent: Task,
): Promise<{ id: string; name: string; url: string | null }[]> {
  if (!parent.integration_id) return [];
  const integ = await getIntegration(parent.integration_id);
  const provider = integ ? getProvider(integ.type) : null;
  if (!integ || integ.type !== "clickup" || !provider?.fetchSubtasks) return [];
  try {
    return await provider.fetchSubtasks(clickupConfig(integ), parent.external_id);
  } catch {
    return [];
  }
}

/**
 * If a just-claimed ClickUp task has subtasks, turn it into a chain parent
 * (subtasks run one-by-one on a shared branch) instead of running it directly.
 * Returns true when it was expanded into a chain.
 */
export async function startTaskOrChain(
  task: Task,
  project: Project,
): Promise<{ chained: boolean; run: Run | null }> {
  if (task.source_type === "clickup" && !task.parent_task_id) {
    const subs = await fetchSubtasks(task);
    if (subs.length > 0) {
      await markChainParent(task.id, branchFor(task)); // task stays 'running'
      await chainTick().catch(() => {});
      return { chained: true, run: null };
    }
  }
  const run = await startRun(task, project);
  return { chained: false, run };
}

async function finishParent(parent: Task, project: Project): Promise<void> {
  const doneStatus = parentDoneStatus(project);
  if (doneStatus && parent.integration_id) {
    try {
      const integ = await getIntegration(parent.integration_id);
      const provider = integ ? getProvider(integ.type) : null;
      if (integ && provider?.resolveTask) {
        await provider.resolveTask(clickupConfig(integ), parent.external_id, {
          status: doneStatus,
        });
      }
    } catch {
      /* best-effort */
    }
  }
  await setTaskStatus(parent.id, "done");
}

/** Advance every active subtask chain by at most one dispatch. */
export async function chainTick(): Promise<void> {
  if (g.__leoChainTicking) return;
  g.__leoChainTicking = true;
  try {
    const parents = await listChainParents();
    for (const parent of parents) {
      try {
        const project = await getProject(parent.project_id);
        if (!project) continue;
        const subs = await fetchSubtasks(parent);
        // A chain parent always had subtasks; an empty result here means a
        // transient fetch error — wait and retry rather than finishing early.
        if (subs.length === 0) continue;
        const children = await listChildTasks(parent.id);
        const byExt = new Map(children.map((c) => [c.external_id, c]));

        if (children.some((c) => c.status === "running")) continue; // wait
        if (children.some((c) => c.status === "failed")) {
          await setTaskStatus(parent.id, "failed");
          continue;
        }
        // Per-project sequential: don't start a chain step while the project is busy.
        const busy =
          (await listRuns({ status: "running", project_id: parent.project_id, limit: 1 }))
            .length > 0;
        if (busy) continue;

        const nextIdx = subs.findIndex((s) => {
          const c = byExt.get(s.id);
          return !(c && (c.status === "done" || c.status === "skipped"));
        });
        if (nextIdx === -1) {
          await finishParent(parent, project);
          continue;
        }

        // Cumulative context from prior done subtasks.
        const priors: { title: string; summary: string }[] = [];
        for (let i = 0; i < nextIdx; i++) {
          const c = byExt.get(subs[i].id);
          if (c && c.status === "done") {
            const runs = await listRuns({ task_id: c.id, limit: 1 });
            priors.push({ title: subs[i].name, summary: runs[0]?.result_summary ?? "" });
          }
        }

        const sub = subs[nextIdx];
        const raw = parent.raw as { list?: { id?: string } } | null;
        const child = await createChainChild({
          project_id: parent.project_id,
          integration_id: parent.integration_id,
          external_id: sub.id,
          title: sub.name,
          url: sub.url,
          raw: { id: sub.id, list: raw?.list },
          parent_task_id: parent.id,
          chain_branch: parent.chain_branch!,
        });
        const chain: ChainContext = {
          branch: parent.chain_branch!,
          base: project.target_branch || project.base_branch || "main",
          index: nextIdx,
          total: subs.length,
          isLast: nextIdx === subs.length - 1,
          priors,
        };
        await startRun(child, project, chain);
      } catch {
        /* keep other chains moving */
      }
    }
  } finally {
    g.__leoChainTicking = false;
  }
}
