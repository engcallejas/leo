import fs from "fs";
import { notFound } from "@/lib/api";
import { getRun } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Server-Sent Events stream that tails a run's JSONL log file until the run
// leaves the "running" state.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const runId = Number(id);
  const run = await getRun(runId);
  if (!run) return notFound("Run no encontrado");

  const logPath = run.log_path;
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
          const cur = await getRun(runId);
          if (!cur || cur.status !== "running") {
            send("status", { status: cur?.status ?? "unknown", run: cur });
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
