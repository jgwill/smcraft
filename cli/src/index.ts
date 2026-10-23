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
import { envAlias } from "@miadi/stateloom-protocol";
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
import { openCommand, defaultWebUrl } from "./commands/open.js";
import { renderCommand } from "./commands/render.js";
import { presenceCommand } from "./commands/presence.js";
import { marksAwait, marksList, marksReply, stageControl, stagePlay, stageShow, stageWhere, type StageCtx } from "./commands/stage.js";

const program = new Command();

program
  .name("smcx")
  .description("stateloom design-surface CLI — drive the live stateloom bridge from the terminal")
  .version("0.1.2")
  .option("--bridge <url>", "bridge socket.io URL", envAlias("BRIDGE_URL"))
  .option("--doc <path>", "SMDF project file (docId)", envAlias("PROJECT_FILE"))
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
  .command("render")
  .description("draw the project file as an image and print where it landed")
  .option("--as <format>", "svg | png | mermaid | ascii", "svg")
  .option("--out <path>", "output file, or '-' for stdout (text formats only)")
  .option("--scale <n>", "pixel multiplier for png (default 2)", parseFloat)
  .option("--theme <theme>", "dark | light", "dark")
  .option("--title <text>", "caption above the board; empty string draws none")
  .option("--stamp", "name the file [ep252--]<Machine>--<yyMMddHHmmss>.<ext> instead of overwriting")
  .option("--open", "open the rendered file in the platform viewer")
  .action(
    async (opts: {
      as?: string;
      out?: string;
      scale?: number;
      theme?: string;
      title?: string;
      open?: boolean;
      stamp?: boolean;
    }) => {
      await renderCommand({ ...opts, doc: resolveDocId(program.opts().doc) });
    }
  );

program
  .command("open")
  .description("open the web designer in the platform browser")
  .option("--web <url>", "web URL", defaultWebUrl())
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

// ─── The stage and the marks (Spec 83) ─────────────────────────────────

function stageCtx(stage?: string): StageCtx {
  const c = ctx();
  return { doc: c.doc, bridgeUrl: c.bridgeUrl, name: c.name, stage };
}

const stage = program.command("stage").description("show the person something on the canvas (Spec 83)");

stage
  .command("show")
  .description("one step now: open a drawing, light part of it, say a sentence beside it")
  .requiredOption("--say <text>", "what you say at this step")
  .option("--focus <kind:name>", "one element to select and centre")
  .option("--spotlight <list>", "elements to light, comma-separated kind:name")
  .option("--title <text>", "a few words over the caption")
  .option("--drawing <path>", "the drawing to open (default --doc)")
  .option("--system <path>", "open it as a member of this .sysdf.json")
  .option("--audio <url>", "a recording of the words to play instead of the canvas voice")
  .option("--stage <name>", "stage name (default STATELOOM_STAGE or 'default')")
  .action(async (opts: { say: string; focus?: string; spotlight?: string; title?: string; drawing?: string; system?: string; audio?: string; stage?: string }) => {
    await stageShow(stageCtx(opts.stage), opts);
  });

stage
  .command("play <tour>")
  .description("hand a .tour.json to the canvases; they play it with their own controls")
  .option("--from <n>", "step to start at, from 1", toInt)
  .option("--paused", "load it without playing")
  .option("--stage <name>", "stage name")
  .action(async (tour: string, opts: { from?: number; paused?: boolean; stage?: string }) => {
    await stagePlay(stageCtx(opts.stage), tour, opts);
  });

stage
  .command("control <action> [index]")
  .description("play | pause | next | prev | goto <n> | stop")
  .option("--stage <name>", "stage name")
  .action(async (action: string, index: string | undefined, opts: { stage?: string }) => {
    await stageControl(stageCtx(opts.stage), action, index ? toInt(index) : undefined);
  });

stage
  .command("where")
  .description("one line: what the person's canvas shows right now")
  .option("--stage <name>", "stage name")
  .action(async (opts: { stage?: string }) => {
    await stageWhere(stageCtx(opts.stage));
  });

const marks = program
  .command("marks")
  .description("what the person marked on the drawings (Spec 83); with no subcommand, list the marks waiting")
  .option("--all", "every mark, answered and resolved too")
  .option("--json", "as JSON")
  .option("--stage <name>", "stage name")
  .action(async (opts: { all?: boolean; json?: boolean; stage?: string }) => {
    await marksList(stageCtx(opts.stage), opts);
  });

marks
  .command("await")
  .description("wait for the person's next mark or reply; exit 0 with it, 4 on timeout (run it as a background task)")
  .option("--timeout <s>", "seconds to wait (default 1800)", toInt)
  .option("--stage <name>", "stage name")
  .action(async (opts: { timeout?: number; stage?: string }) => {
    process.exitCode = await marksAwait(stageCtx(opts.stage), opts);
  });

marks
  .command("reply <id> [text]")
  .description("answer a mark in its thread, as the agent (--name or STATELOOM_AGENT_NAME)")
  .option("--resolve", "close the mark")
  .option("--stage <name>", "stage name")
  .action(async (id: string, text: string | undefined, opts: { resolve?: boolean; stage?: string }) => {
    await marksReply(stageCtx(opts.stage), id, text, opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
