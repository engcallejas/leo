import { migrate } from "./db";
import { ensureScheduler } from "./orchestrator/scheduler";

// Idempotent process-wide bootstrap. Triggered from the root layout (a Node
// server component) so the scheduler starts as soon as the app is served —
// without an instrumentation hook (which would be compiled for the Edge
// runtime and choke on Node built-ins).
const g = globalThis as unknown as { __leoBoot?: Promise<void> };

export function boot(): Promise<void> {
  if (!g.__leoBoot) {
    g.__leoBoot = (async () => {
      // Don't spin up timers/child processes during `next build` prerender.
      if (process.env.NEXT_PHASE === "phase-production-build") {
        await migrate();
        return;
      }
      await migrate();
      await ensureScheduler();
      console.log("[leo] scheduler started");
    })();
  }
  return g.__leoBoot;
}
