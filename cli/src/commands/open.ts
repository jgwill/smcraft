/**
 * `smcx open` — launch the platform browser-opener at the web designer URL.
 *
 * Non-fatal by design: if no opener exists (headless server, missing binary),
 * we simply print the URL for the operator to open manually.
 */
import { spawn } from "node:child_process";

export interface OpenOpts {
  url?: string;
}

function openerFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  return "xdg-open";
}

export async function openCommand(opts: OpenOpts): Promise<void> {
  const url = opts.url ?? "http://localhost:3000";
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
