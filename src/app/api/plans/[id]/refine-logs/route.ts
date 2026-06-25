import fs from "fs";
import path from "path";
import { notFound } from "@/lib/api";
import { LOGS_DIR } from "@/lib/db";
import { getPlan } from "@/lib/plan-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// SSE stream that tails a plan's refinement log until it leaves "refining".
// Opening it after refinement replays the whole log once, then closes.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const planId = Number(id);
  const plan = await getPlan(planId);
  if (!plan) return notFound("Plan no encontrado");

  const logPath =
    plan.refine_log || path.join(LOGS_DIR, `plan-refine-${planId}.jsonl`);
  const encoder = new TextEncoder();
  let position = 0;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const poll = async () => {
        if (closed) return;
        try {
          if (fs.existsSync(logPath)) {
            const stat = fs.statSync(logPath);
            if (stat.size > position) {
              const fd = fs.openSync(logPath, "r");
              const len = stat.size - position;
              const buf = Buffer.alloc(len);
              fs.readSync(fd, buf, 0, len, position);
              fs.closeSync(fd);
              position = stat.size;
              send("chunk", { text: buf.toString("utf8") });
            }
          }
          const cur = await getPlan(planId);
          if (!cur || cur.status !== "refining") {
            send("status", { status: cur?.status ?? "unknown" });
            send("done", {});
            closed = true;
            controller.close();
            return;
          }
        } catch (e) {
          send("error", { message: (e as Error).message });
        }
        if (!closed) setTimeout(poll, 1000);
      };

      void poll();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
