import { spawn } from "child_process";
import { badRequest, json, serverError } from "@/lib/api";
import { envFlags } from "@/lib/claude-auth";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Launch the interactive Claude auth flow in a real macOS Terminal window. The
// flow needs a TTY + browser, which a headless server can't provide — so on a
// macOS host we hand it off to Terminal.app and then auto-detect via
// `claude auth status`. (In containers / non-macOS this isn't available.)
export async function POST(req: Request) {
  const { canLaunchTerminal } = envFlags();
  if (!canLaunchTerminal) {
    return badRequest(
      "El lanzamiento automático solo está disponible en un host macOS. En Docker/Linux genera el token con `claude setup-token` y pégalo abajo.",
    );
  }

  let tool = "setup-token";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.tool === "login") tool = "auth login --claudeai";
  } catch {
    /* default */
  }

  try {
    const settings = await getSettings();
    const bin = settings.claude_binary_path || "claude";
    const cmd = `${bin} ${tool}`.replace(/"/g, '\\"');
    const child = spawn(
      "osascript",
      [
        "-e",
        'tell application "Terminal" to activate',
        "-e",
        `tell application "Terminal" to do script "${cmd}"`,
      ],
      { stdio: "ignore", detached: true },
    );
    child.unref();
    return json({ launched: true, tool });
  } catch (e) {
    return serverError(e);
  }
}
