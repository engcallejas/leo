import { json, serverError } from "@/lib/api";
import {
  getActiveAccountId,
  getActiveProjectId,
  listAccounts,
} from "@/lib/account-repo";
import { listProjects } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-shot workspace state for the sidebar/provider: the accounts, the active
 * account, that account's projects, and the active project (the view scope).
 */
export async function GET() {
  try {
    const accountId = await getActiveAccountId();
    const [accounts, projects, activeProjectId] = await Promise.all([
      listAccounts(),
      listProjects(accountId),
      getActiveProjectId(),
    ]);
    return json({
      accounts,
      activeAccountId: accountId,
      projects,
      activeProjectId,
    });
  } catch (e) {
    return serverError(e);
  }
}
