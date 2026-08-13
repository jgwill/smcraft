/**
 * `smcx serve` — boot the smcraft bridge hub and keep it alive until SIGINT.
 */
import { startBridge } from "@miadi/stateloom";

export interface ServeOpts {
  port?: number;
  host?: string;
  file?: string;
}

export async function serveCommand(opts: ServeOpts): Promise<void> {
  const handle = await startBridge({ port: opts.port, host: opts.host, file: opts.file });
  console.log(`stateloom bridge listening on ${handle.url}`);
  if (opts.file) console.log(`  doc: ${opts.file}`);
  console.log("  (Ctrl-C to stop)");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      void handle.close().then(() => {
        console.log("\nbridge stopped.");
        resolve();
      });
    });
  });
}
