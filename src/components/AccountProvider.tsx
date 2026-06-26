"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Account, Project } from "@/lib/types";
import { api } from "./client";

interface AccountCtx {
  accounts: Account[];
  activeAccountId: number | null;
  activeAccount: Account | null;
  /** Projects of the active account (what the sidebar selector lists). */
  projects: Project[];
  activeProjectId: number | null;
  activeProject: Project | null;
  loading: boolean;
  /** Switch the active project (the view scope) and reload. */
  switchProject: (id: number) => Promise<void>;
  /** Switch the active account (from the Cuenta page) and reload. */
  switchAccount: (id: number) => Promise<void>;
  /** Create a new account, activate it, and reload. */
  createAccount: (name: string, color?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AccountCtx | null>(null);

export function useAccount(): AccountCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccount debe usarse dentro de <AccountProvider>");
  return c;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get("/api/workspace");
      setAccounts(data.accounts ?? []);
      setActiveAccountId(data.activeAccountId ?? null);
      setProjects(data.projects ?? []);
      setActiveProjectId(data.activeProjectId ?? null);
    } catch {
      /* ignore — sidebar shows a placeholder */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Switching the view scope (project) or workspace (account) flips a server-side
  // pointer and reloads — every independently-polling view then re-fetches under
  // the new scope with no stale state. Background runs are unaffected (the
  // scheduler never reads these pointers).
  const switchProject = useCallback(async (id: number) => {
    await api.put("/api/projects/active", { id });
    window.location.reload();
  }, []);

  const switchAccount = useCallback(async (id: number) => {
    await api.put("/api/accounts/active", { id });
    window.location.reload();
  }, []);

  const createAccount = useCallback(async (name: string, color?: string) => {
    await api.post("/api/accounts", { name, color, activate: true });
    window.location.reload();
  }, []);

  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) ?? null;
  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <Ctx.Provider
      value={{
        accounts,
        activeAccountId,
        activeAccount,
        projects,
        activeProjectId,
        activeProject,
        loading,
        switchProject,
        switchAccount,
        createAccount,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
