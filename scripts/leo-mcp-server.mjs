#!/usr/bin/env node
/**
 * Leo MCP server (stdio). Exposes two tools so a headless Claude run can pause
 * and ask the human through Leo's UI:
 *   - ask_user(question, options?)      → returns the chosen/typed answer
 *   - request_approval(action, detail?) → returns "approved" or "denied"
 *
 * It talks to Leo over HTTP (LEO_BASE_URL) and correlates by LEO_RUN_ID. The
 * tool call blocks (long-poll) until the user answers in the UI. Protocol is
 * JSON-RPC 2.0 over newline-delimited stdio. Nothing is logged to stdout (that
 * would corrupt the protocol); diagnostics go to stderr.
 */

const BASE = process.env.LEO_BASE_URL || "http://127.0.0.1:3000";
const RUN_ID = process.env.LEO_RUN_ID || "";
// Where to POST new interactions. Dev runs default to the run endpoint; plan
// refinements override this with /api/plans/<id>/interactions. The poll/answer
// endpoints are keyed by interaction id, so they work the same for both.
const CREATE_PATH =
  process.env.LEO_INTERACTIONS_PATH || `/api/runs/${RUN_ID}/interactions`;
// Endpoint the check_in tool pulls human steering notes from (dev runs only).
const NOTES_PATH =
  process.env.LEO_NOTES_PATH || (RUN_ID ? `/api/runs/${RUN_ID}/notes/consume` : "");
const POLL_MS = 1500;
const TIMEOUT_MS = 30 * 60 * 1000; // 30 min

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}
function log(...a) {
  process.stderr.write("[leo-mcp] " + a.join(" ") + "\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createInteraction(kind, question, options) {
  const res = await fetch(`${BASE}${CREATE_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, question, options: options || [] }),
  });
  if (!res.ok) throw new Error(`create interaction ${res.status}`);
  const body = await res.json();
  return body.id;
}

async function waitForAnswer(id) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await sleep(POLL_MS);
    try {
      const res = await fetch(`${BASE}/api/interactions/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const it = await res.json();
      if (it.status === "answered") return it.answer ?? "";
      if (it.status === "cancelled")
        return "(la pregunta fue cancelada porque el run terminó)";
    } catch {
      /* Leo may be briefly down (restart) — keep polling */
    }
  }
  return "(sin respuesta del humano dentro del tiempo límite; procede con tu mejor criterio)";
}

const TOOLS = [
  {
    name: "ask_user",
    description:
      "Ask the human a clarifying question and wait for their answer. Use this whenever the requirement is ambiguous instead of guessing. Optionally provide a list of options.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask." },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of suggested answers.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "request_approval",
    description:
      "Ask the human to approve or reject a specific action before doing it (e.g. a risky or irreversible step). Returns 'approved' or 'denied'.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "The action needing approval." },
        detail: { type: "string", description: "Extra context for the human." },
      },
      required: ["action"],
    },
  },
  {
    name: "check_in",
    description:
      "Check for steering notes the human pushed while you work. Call this PROACTIVELY at checkpoints — before committing, before opening a PR, when finishing a logical chunk, and whenever you'd otherwise proceed on an assumption. It's cheap and non-blocking: it returns any new human instructions to incorporate (or says there are none), so you can course-correct without redoing work.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handleToolCall(name, argsObj) {
  const a = argsObj || {};
  if (name === "ask_user") {
    const id = await createInteraction(
      "question",
      String(a.question || "¿?"),
      Array.isArray(a.options) ? a.options.map(String) : [],
    );
    return await waitForAnswer(id);
  }
  if (name === "request_approval") {
    const q = a.detail ? `${a.action}\n\n${a.detail}` : String(a.action || "");
    const id = await createInteraction("approval", q, ["approved", "denied"]);
    return await waitForAnswer(id);
  }
  if (name === "check_in") {
    if (!NOTES_PATH) return "No hay buzón de notas para este run.";
    try {
      const res = await fetch(`${BASE}${NOTES_PATH}`, { method: "POST" });
      if (!res.ok) return "(no se pudo consultar el buzón de notas)";
      const body = await res.json();
      const notes = Array.isArray(body.notes) ? body.notes : [];
      if (!notes.length) return "No hay notas nuevas del humano. Continúa.";
      return (
        "NOTAS NUEVAS DEL HUMANO (incorpóralas a tu trabajo en curso):\n" +
        notes.map((n, i) => `${i + 1}. ${n}`).join("\n")
      );
    } catch (e) {
      return `(error consultando el buzón: ${e.message})`;
    }
  }
  throw new Error(`unknown tool ${name}`);
}

async function onMessage(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "leo", version: "1.0.0" },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return; // notification, no reply
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params && params.name;
    try {
      const text = await handleToolCall(name, params && params.arguments);
      reply(id, { content: [{ type: "text", text }] });
    } catch (e) {
      reply(id, {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      });
    }
    return;
  }
  if (id !== undefined && id !== null) {
    replyError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log("bad json:", line.slice(0, 120));
      continue;
    }
    Promise.resolve(onMessage(msg)).catch((e) => log("handler error:", e.message));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`started → ${BASE}${CREATE_PATH}`);
