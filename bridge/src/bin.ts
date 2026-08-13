#!/usr/bin/env node
/**
 * `smcraft-bridge` — boot the socket.io hub as a standalone process.
 *
 * Flags win over env; env wins over the defaults:
 *   --port <n>     STATELOOM_BRIDGE_PORT   / SMCRAFT_BRIDGE_PORT   (default 4599)
 *   --host <h>     STATELOOM_BRIDGE_HOST   / SMCRAFT_BRIDGE_HOST   (default 127.0.0.1)
 *   --doc <path>   STATELOOM_PROJECT_FILE  / SMCRAFT_PROJECT_FILE  (default docId; durable truth + docId source)
 *   --token <t>    STATELOOM_BRIDGE_TOKEN  / SMCRAFT_BRIDGE_TOKEN  (optional handshake auth token)
 *
 * Until 0.1.3 this binary read the environment ONLY, and every `--port` on
 * every command line in this repo — scripts/live-loop.sh included — was parsed
 * by nobody. It never showed, because the flags always repeated the value the
 * env already carried. The failure it was waiting for is a service unit that
 * passes `--port 4698` and gets a hub on 4599: accepted, silently dropped,
 * listening confidently in the wrong place. An argument that cannot change the
 * outcome is worse than one that is rejected, so these are read now and an
 * unknown flag is an error rather than a shrug.
 */
import { envAlias } from "@miadi/stateloom-protocol";
import { startBridge } from "./hub.js";

const USAGE = `smcraft-bridge — the stateloom socket.io hub

Usage
  smcraft-bridge [options]

Options
  --port <n>     port to listen on (default 4599, the hub half of the loom's pair)
  --host <h>     interface to bind (default 127.0.0.1)
  --doc <path>   default document — durable truth and docId source
  --token <t>    require this token on the socket handshake
  --help         print this and exit
  --version      print the hub version and exit

Environment (flags win; the legacy SMCRAFT_* twin of each name is honored)
  STATELOOM_BRIDGE_PORT   STATELOOM_BRIDGE_HOST
  STATELOOM_PROJECT_FILE  STATELOOM_BRIDGE_TOKEN`;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const takesValue = new Set(["--port", "--host", "--doc", "--token"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    if (arg === "--version" || arg === "-v") {
      process.stdout.write(`${VERSION}\n`);
      process.exit(0);
    }
    if (takesValue.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        process.stderr.write(`[smcraft-bridge] ${arg} needs a value\n`);
        process.exit(2);
      }
      out[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    // Silence here is the defect this parser exists to remove.
    process.stderr.write(`[smcraft-bridge] unknown option: ${arg}\n${USAGE}\n`);
    process.exit(2);
  }
  return out;
}

const VERSION = "0.1.3";

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  const port = Number(flags.port ?? envAlias("BRIDGE_PORT") ?? 4599);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    process.stderr.write(`[smcraft-bridge] not a port: ${flags.port ?? envAlias("BRIDGE_PORT")}\n`);
    process.exit(2);
  }
  const host = flags.host ?? envAlias("BRIDGE_HOST") ?? "127.0.0.1";
  const file = flags.doc ?? envAlias("PROJECT_FILE");
  const token = flags.token ?? envAlias("BRIDGE_TOKEN");

  const handle = await startBridge({ port, host, file, token, cors: true });
  process.stderr.write(`[smcraft-bridge] listening on ${handle.url}\n`);
  if (file) process.stderr.write(`[smcraft-bridge] default docId: ${file}\n`);

  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[smcraft-bridge] failed to start: ${String(err)}\n`);
  process.exit(1);
});
