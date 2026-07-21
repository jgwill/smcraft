#!/usr/bin/env node
/**
 * `smcraft-bridge` — boot the socket.io hub as a standalone process.
 *
 * Env:
 *   SMCRAFT_BRIDGE_PORT   (default 4599)
 *   SMCRAFT_BRIDGE_HOST   (default 127.0.0.1)
 *   SMCRAFT_PROJECT_FILE  (default docId; durable truth + docId source)
 *   SMCRAFT_BRIDGE_TOKEN  (optional handshake auth token)
 */
import { startBridge } from "./hub.js";

async function main(): Promise<void> {
  const port = Number(process.env.SMCRAFT_BRIDGE_PORT ?? 4599);
  const host = process.env.SMCRAFT_BRIDGE_HOST ?? "127.0.0.1";
  const file = process.env.SMCRAFT_PROJECT_FILE;
  const token = process.env.SMCRAFT_BRIDGE_TOKEN;

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
