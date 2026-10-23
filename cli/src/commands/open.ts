/**
 * `smcx open` — launch the platform browser-opener at the web designer URL.
 *
 * Non-fatal by design: if no opener exists (headless server, missing binary),
 * we simply print the URL for the operator to open manually.
 */
import { spawn } from "node:child_process";
import { envAlias } from "@miadi/stateloom-protocol";

export interface OpenOpts {
  url?: string;
}

function openerFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  return "xdg-open";
}

/**
 * The designer's own port, not a generic dev-server guess: 4598 (canvas) and
 * 4599 (hub) are the loom's pair, and `web/package.json` binds 4598. Honoring
 * STATELOOM_WEB_PORT keeps this agreeing with `scripts/live-loop.sh`, which is
 * what sets the port for every other process in the loop.
 */
export function defaultWebUrl(env = process.env): string {
  const port = envAlias("WEB_PORT", env) ?? "4598";
  return `http://localhost:${port}`;
}

export async function openCommand(opts: OpenOpts): Promise<void> {
  const url = opts.url ?? defaultWebUrl();
  const opener = openerFor(process.platform);
  try {
    const child = spawn(opener, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    });
    child.on("error", () => {
      console.log(`open: could not launch "${opener}" — visit ${url} manually`);
    });
    child.unref();
    console.log(`opening ${url} …`);
  } catch {
    console.log(`open: unavailable — visit ${url} manually`);
  }
}
