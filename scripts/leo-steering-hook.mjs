#!/usr/bin/env node
/**
 * Leo steering hook (PostToolUse + Stop). Wired into a dev run's --settings.
 *
 * It makes human steering notes reach the agent RELIABLY instead of depending on
 * the agent remembering to call the `check_in` MCP tool. On every tool boundary
 * and whenever the agent tries to finish, it drains the run's note inbox and
 * pushes any pending instructions back into the model:
 *
 *   - PostToolUse → { hookSpecificOutput.additionalContext }  (non-blocking; the
 *                    agent reads it on its next turn — frequent, low-latency)
 *   - Stop        → { decision: "block", reason }             (the agent CANNOT
 *                    finish while there is undelivered steering — the safety net)
 *
 * Notes are single-delivery: consuming marks them delivered, so each note blocks
 * Stop at most once → no infinite loop. Run id + base URL are baked in by Leo as
 * argv. ANY failure (Leo down, no stdin) is a silent no-op (exit 0, no output) so
 * the agent is never blocked by Leo being unreachable.
 */

const RUN_ID = process.argv[2] || "";
const BASE = process.argv[3] || "http://127.0.0.1:3000";

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    try {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (buf += c));
      process.stdin.on("end", () => resolve(buf));
    } catch {
      resolve(buf);
    }
    // Never hang if stdin doesn't close.
    setTimeout(() => resolve(buf), 2000);
  });
}

async function main() {
  if (!RUN_ID) return;
  const raw = await readStdin();
  let event = "";
  try {
    event = JSON.parse(raw || "{}").hook_event_name || "";
  } catch {
    /* default below */
  }

  let notes = [];
  try {
    const res = await fetch(`${BASE}/api/runs/${RUN_ID}/notes/consume`, {
      method: "POST",
    });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body.notes)) notes = body.notes;
    }
  } catch {
    return; // Leo unreachable → never block the agent
  }
  if (!notes.length) return;

  const msg =
    "📨 NOTAS NUEVAS DEL HUMANO (correcciones sobre la marcha — incorpóralas YA " +
    "a tu trabajo en curso; tienen prioridad sobre tu plan previo):\n" +
    notes.map((n, i) => `${i + 1}. ${n}`).join("\n");

  if (event === "Stop") {
    // Don't let the agent finish until it has acknowledged the steering.
    process.stdout.write(
      JSON.stringify({ decision: "block", reason: msg }) + "\n",
    );
  } else {
    // PostToolUse: inject as context the model reads on its next turn.
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: msg,
        },
      }) + "\n",
    );
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
