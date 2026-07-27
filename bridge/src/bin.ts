#!/usr/bin/env node
/**
 * `smcraft-bridge` — boot the socket.io hub as a standalone process.
 *
 * Env (STATELOOM_* read first, SMCRAFT_* legacy twin honored):
 *   STATELOOM_BRIDGE_PORT   / SMCRAFT_BRIDGE_PORT   (default 4599)
 *   STATELOOM_BRIDGE_HOST   / SMCRAFT_BRIDGE_HOST   (default 127.0.0.1)
 *   STATELOOM_PROJECT_FILE  / SMCRAFT_PROJECT_FILE  (default docId; durable truth + docId source)
 *   STATELOOM_BRIDGE_TOKEN  / SMCRAFT_BRIDGE_TOKEN  (optional handshake auth token)
 */
import { envAlias } from "@miadi/stateloom-protocol";
import { startBridge } from "./hub.js";

async function main(): Promise<void> {
  const port = Number(envAlias("BRIDGE_PORT") ?? 4599);
  const host = envAlias("BRIDGE_HOST") ?? "127.0.0.1";
  const file = envAlias("PROJECT_FILE");
  const token = envAlias("BRIDGE_TOKEN");

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
