#!/usr/bin/env node
/**
 * smcx — the smcraft design-surface CLI.
 *
 * A thin commander shell over the testable command functions. Global options
 * name the bridge, the project file (docId), and this client's presence label;
 * subcommands mutate the durable doc (persist-then-emit), stream the live doc,
 * boot the hub, or inspect presence.
 */
import { Command } from "commander";
import { resolveDocId } from "./docio.js";
import type { MutateCtx } from "./mutate.js";
import {
  addState,
  addEvent,
  addTransition,
  removeState,
  loadFile,
} from "./commands/mutations.js";
import { watchCommand } from "./commands/watch.js";
import { serveCommand } from "./commands/serve.js";
import { openCommand } from "./commands/open.js";
import { presenceCommand } from "./commands/presence.js";

const program = new Command();

program
  .name("smcx")
  .description("smcraft design-surface CLI — drive the live smcraft bridge from the terminal")
  .version("0.1.0")
  .option("--bridge <url>", "bridge socket.io URL", process.env.SMCRAFT_BRIDGE_URL)
  .option("--doc <path>", "SMDF project file (docId)", process.env.SMCRAFT_PROJECT_FILE)
  .option("--name <label>", "presence label for this CLI client");

/** Build the durable-first mutate context from the resolved global options. */
function ctx(): MutateCtx {
  const o = program.opts<{ bridge?: string; doc?: string; name?: string }>();
  return { doc: resolveDocId(o.doc), bridgeUrl: o.bridge || undefined, name: o.name };
}

const toInt = (v: string): number => parseInt(v, 10);

program
  .command("serve")
  .description("boot the bridge hub and keep it alive")
  .option("--port <n>", "port to bind (0 = ephemeral)", toInt)
  .option("--host <host>", "host/interface to bind")
  .option("--file <path>", "seed docId file")
  .action(async (opts: { port?: number; host?: string; file?: string }) => {
    await serveCommand({
      port: opts.port,
      host: opts.host,
      file: opts.file ?? resolveDocId(program.opts().doc),
    });
  });

program
  .command("add-state <name>")
  .description("add a state (persist + emit)")
  .option("--parent <name>", "parent state name (default Root)")
  .option("--kind <kind>", "state kind: normal | final | history")
  .option("--desc <text>", "description")
  .action(async (name: string, opts: { parent?: string; kind?: string; desc?: string }) => {
    await addState(name, opts, ctx());
  });

program
  .command("add-event <id>")
  .description("add an event to an event source (persist + emit)")
  .option("--source <index>", "event source index (default 0)", toInt)
  .option("--desc <text>", "description")
  .action(async (id: string, opts: { source?: number; desc?: string }) => {
    await addEvent(id, opts, ctx());
  });

program
  .command("add-transition <state> <event>")
  .description("add a transition from <state> on <event> (persist + emit)")
  .option("--to <state>", "target state")
  .option("--when <cond>", "guard condition")
  .action(async (state: string, event: string, opts: { to?: string; when?: string }) => {
    await addTransition(state, event, opts, ctx());
  });

program
  .command("remove-state <name>")
  .description("remove a state (persist + emit)")
  .action(async (name: string) => {
    await removeState(name, ctx());
  });

program
  .command("load <file>")
  .description("load a whole definition from <file> into the doc (persist + emit)")
  .action(async (file: string) => {
    await loadFile(file, ctx());
  });

program
  .command("watch")
  .description("stream the live doc to the terminal until Ctrl-C")
  .option("--as <mode>", "render mode: ascii | mermaid", "ascii")
  .action(async (opts: { as?: "ascii" | "mermaid" }) => {
    const c = ctx();
    await watchCommand({ doc: c.doc, bridgeUrl: c.bridgeUrl, as: opts.as });
  });

program
  .command("open")
  .description("open the web designer in the platform browser")
  .option("--web <url>", "web URL", "http://localhost:3000")
  .action(async (opts: { web?: string }) => {
    await openCommand({ url: opts.web });
  });

program
  .command("presence")
  .description("print the live peer roster and exit")
  .action(async () => {
    const c = ctx();
    await presenceCommand({ doc: c.doc, bridgeUrl: c.bridgeUrl, name: c.name });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
