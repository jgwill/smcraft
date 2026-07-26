/**
 * `smcx watch` — a live terminal mirror of the bridge document.
 *
 * Joins the room (role `cli`), seeds the local def from the join snapshot, then
 * reacts to every `def:full` / `def:patch`: structural ops advance the local
 * def via `applyPatchOps`, `runtime.enter` / `runtime.exit` maintain an `active`
 * set, and each change clears the screen and reprints the chosen renderer. Runs
 * until SIGINT.
 */
import { applyPatchOps, type StateMachineDefinition } from "@smcraft/bridge-protocol";
import { createBridgeClient } from "@smcraft/bridge-client";
import { EMPTY_DEF } from "../mutate.js";
import { renderAscii } from "../render/ascii.js";
import { renderMermaid } from "../render/mermaid.js";

export interface WatchOpts {
  doc: string;
  bridgeUrl?: string;
  as?: "ascii" | "mermaid";
}

export async function watchCommand(opts: WatchOpts): Promise<void> {
  if (!opts.bridgeUrl) {
    console.error("watch: no bridge URL — set --bridge or SMCRAFT_BRIDGE_URL");
    process.exitCode = 1;
    return;
  }

  const as = opts.as ?? "ascii";
  const client = createBridgeClient({ url: opts.bridgeUrl, role: "cli", docId: opts.doc });
  const active = new Set<string>();
  let def: StateMachineDefinition = EMPTY_DEF;

  const render = (): void => {
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen + home cursor
    process.stdout.write(`smcx watch — ${opts.doc} @ ${opts.bridgeUrl} (${client.status})\n\n`);
    const body = as === "mermaid" ? renderMermaid(def) : renderAscii(def, active);
    process.stdout.write(body + "\n");
  };

  client.on("full", (env) => {
    if (env.def) def = env.def;
    render();
  });

  client.on("patch", (env) => {
    for (const op of env.ops ?? []) {
      if (op.op === "runtime.enter") active.add(op.state);
      else if (op.op === "runtime.exit") active.delete(op.state);
    }
    try {
      def = applyPatchOps(def, env.ops ?? []);
    } catch {
      client.request(); // desync — ask the hub for a fresh snapshot
    }
    render();
  });

  client.on("presence", () => render());
  client.on("status", () => render());

  const joined = await client.join();
  if (joined.snapshot?.def) def = joined.snapshot.def;
  render();

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      client.disconnect();
      process.stdout.write("\n");
      resolve();
    });
  });
}
