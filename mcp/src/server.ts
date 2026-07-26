#!/usr/bin/env node
/**
 * SMCraft MCP Server
 *
 * Provides tools for LLM agents to design, validate, and generate
 * state machines through conversation.
 *
 * Tools:
 *   - create_state_machine: Create a new state machine definition
 *   - add_state: Add a state to the definition
 *   - add_event: Add an event to the definition
 *   - add_transition: Add a transition to a state
 *   - remove_state: Remove a state from the definition
 *   - validate_definition: Validate the current definition
 *   - generate_code: Generate Python or TypeScript code
 *   - get_definition: Get the current definition as JSON
 *   - load_definition: Load a definition from JSON
 *   - list_states: List all states in the current definition
 *   - list_events: List all events in the current definition
 *
 * Resources:
 *   - smcraft://definition — Current state machine definition
 *
 * Prompts:
 *   - design-state-machine — Guided state machine design conversation
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createBridgeClient, type BridgeClient } from "@smcraft/bridge-client";
import type { PatchOp, StateMachineDefinition } from "@smcraft/bridge-protocol";

// ─── In-memory state machine definition ──────────────────────────────

interface StateDef {
  name: string;
  kind?: "normal" | "final" | "history";
  description?: string;
  transitions?: TransitionDef[];
  states?: StateDef[];
  onEntry?: string;
  onExit?: string;
}

interface TransitionDef {
  event: string;
  nextState?: string;
  condition?: string;
  description?: string;
}

interface EventDef {
  id: string;
  description?: string;
}

interface Definition {
  settings: {
    namespace: string;
    name: string;
    asynchronous: boolean;
    _source?: {
      kind?: string;
      pdeId?: string;
      pdeFolder?: string;
      originalPrompt?: string;
      engine?: string;
    };
  };
  events: { name: string; events: EventDef[] }[];
  state: StateDef;
}

// ─── File-backed shared store ────────────────────────────────────────
// Both web/ and mcp/ resolve the same path from SMCRAFT_PROJECT_FILE.
// Web reads/writes via /api/file; mcp reads/writes here. fs.watch on
// the web side broadcasts disk changes back to the canvas.

const PROJECT_FILE = resolve(
  process.env.SMCRAFT_PROJECT_FILE ?? "./statemachine.smdf.json"
);

function readDef(): Definition | null {
  if (!existsSync(PROJECT_FILE)) return null;
  try {
    const raw = readFileSync(PROJECT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.stateMachine ?? parsed.StateMachine ?? parsed;
  } catch (e) {
    console.error(`[smcraft-mcp] Failed to read ${PROJECT_FILE}:`, e);
    return null;
  }
}

function writeDef(def: Definition): void {
  writeFileSync(PROJECT_FILE, JSON.stringify({ stateMachine: def }, null, 2), "utf8");
}

// ─── Optional real-time design bridge (env-gated, best-effort) ───────
// When SMCRAFT_BRIDGE_URL is set, each mutation is mirrored to the bridge
// hub so a live web canvas updates as the agent edits. Fully backward-
// compatible: the file on disk remains the durable truth, every bridge
// call is wrapped so any failure degrades to a no-op, and standalone
// operation (no SMCRAFT_BRIDGE_URL) is untouched.

let bridge: BridgeClient | undefined;
if (!process.env.SMCRAFT_BRIDGE_URL) {
  console.error(
    "[smcraft-mcp] SMCRAFT_BRIDGE_URL is not set — edits persist to disk but " +
      "are NOT broadcast; a live canvas will not update. Set SMCRAFT_BRIDGE_URL " +
      "(e.g. http://127.0.0.1:4599) on this MCP process to go live."
  );
}
if (process.env.SMCRAFT_BRIDGE_URL) {
  try {
    bridge = createBridgeClient({
      url: process.env.SMCRAFT_BRIDGE_URL,
      role: "agent",
      docId: PROJECT_FILE,
      name: process.env.SMCRAFT_AGENT_NAME ?? "mcp-agent",
      token: process.env.SMCRAFT_BRIDGE_TOKEN,
    });
  } catch (e) {
    console.error("[smcraft-mcp] bridge init failed (continuing standalone):", e);
    bridge = undefined;
  }

  // Best-effort teardown on process exit.
  let bridgeClosed = false;
  const closeBridge = (): void => {
    if (bridgeClosed) return;
    bridgeClosed = true;
    try {
      bridge?.disconnect();
    } catch {
      /* best-effort */
    }
  };
  process.on("exit", closeBridge);
  process.on("SIGINT", () => {
    closeBridge();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    closeBridge();
    process.exit(0);
  });
}

// Emit precise granular ops (never diffs) AFTER writeDef. The mtime is
// stamped from the file we just wrote so the hub can dedup its own
// file-watch echo of this same change.
let droppedEmitWarned = false;
function warnDroppedEmit(kind: string): void {
  if (droppedEmitWarned) return;
  droppedEmitWarned = true;
  console.error(
    `[smcraft-mcp] dropped ${kind} emit — bridge ` +
      (bridge ? `status=${bridge.status}` : "not configured (SMCRAFT_BRIDGE_URL unset)") +
      "; disk write succeeded, live canvas did not update. (warned once)"
  );
}

function bridgeEmitPatch(ops: PatchOp[]): void {
  if (!bridge || bridge.status !== "connected") {
    warnDroppedEmit("patch");
    return;
  }
  try {
    const mtime = statSync(PROJECT_FILE).mtimeMs;
    bridge.emitPatch(ops, mtime);
  } catch {
    /* best-effort */
  }
}

function bridgeEmitFull(def: Definition): void {
  if (!bridge || bridge.status !== "connected") {
    warnDroppedEmit("full-def");
    return;
  }
  try {
    const mtime = statSync(PROJECT_FILE).mtimeMs;
    // Local Definition/StateDef differ slightly from the protocol's
    // StateMachineDefinition; the payload is serialized as-is over the wire.
    bridge.emitFull(def as unknown as StateMachineDefinition, mtime);
  } catch {
    /* best-effort */
  }
}

function createEmpty(namespace: string, name: string): Definition {
  return {
    settings: { namespace, name, asynchronous: false },
    events: [{ name: "Internal", events: [] }],
    state: { name: "Root", states: [] },
  };
}

function findState(root: StateDef, name: string): StateDef | null {
  if (root.name === name) return root;
  for (const child of root.states ?? []) {
    const found = findState(child, name);
    if (found) return found;
  }
  return null;
}

function removeState(root: StateDef, name: string): StateDef {
  return {
    ...root,
    states: root.states
      ?.filter((s) => s.name !== name)
      .map((s) => removeState(s, name)),
  };
}

function collectStateNames(root: StateDef): string[] {
  const names = [root.name];
  for (const child of root.states ?? []) {
    names.push(...collectStateNames(child));
  }
  return names;
}

function collectEventIds(def: Definition): string[] {
  return def.events.flatMap((src) => src.events.map((e) => e.id));
}

interface ValidationError {
  ruleId: string;
  message: string;
}

function validate(def: Definition): ValidationError[] {
  const errors: ValidationError[] = [];
  const stateNames = collectStateNames(def.state);
  const eventIds = collectEventIds(def);

  if (eventIds.length === 0) {
    errors.push({ ruleId: "V001", message: "No events defined" });
  }

  const seen = new Set<string>();
  for (const name of stateNames) {
    if (seen.has(name))
      errors.push({
        ruleId: "V002",
        message: `Duplicate state name: ${name}`,
      });
    seen.add(name);
  }

  const checkTransitions = (state: StateDef) => {
    for (const t of state.transitions ?? []) {
      if (!eventIds.includes(t.event))
        errors.push({
          ruleId: "V003",
          message: `State '${state.name}' references unknown event '${t.event}'`,
        });
      if (t.nextState && !stateNames.includes(t.nextState))
        errors.push({
          ruleId: "V004",
          message: `State '${state.name}' targets unknown state '${t.nextState}'`,
        });
    }
    (state.states ?? []).forEach(checkTransitions);
  };
  checkTransitions(def.state);

  if (!def.state.states || def.state.states.length === 0)
    errors.push({
      ruleId: "V005",
      message: "Root must have at least one child state",
    });

  return errors;
}

function generateViaSmcg(def: Definition, language: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "smcraft-"));
  // Sanitize the input filename — settings.name is agent-controlled free text.
  const safeName = String(def.settings.name ?? "machine").replace(/[^A-Za-z0-9_.-]/g, "_");
  const inputFile = join(tmpDir, `${safeName}.smdf.json`);
  const outputDir = join(tmpDir, "output");

  try {
    // Write definition as SMDF JSON
    const smdf = { settings: def.settings, events: def.events, state: def.state };
    writeFileSync(inputFile, JSON.stringify(smdf, null, 2));

    // Call real smcg CLI — execFileSync (no shell) so a crafted name cannot
    // inject shell commands.
    execFileSync("smcg", [inputFile, "-l", language, "-o", outputDir], {
      encoding: "utf-8",
      timeout: 30000,
    });

    // Read generated output
    const ext = language === "python" ? "py" : "ts";
    const name = def.settings.name ?? "machine";
    const outputFile = join(outputDir, `${name}_fsm.${ext}`);
    return readFileSync(outputFile, "utf-8");
  } catch (e: any) {
    // Fallback to lightweight inline generation if smcg fails
    return language === "python"
      ? generatePythonFallback(def)
      : generateTypeScriptFallback(def);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// Fallback lightweight generators (used when smcg CLI unavailable)
function generatePythonFallback(def: Definition): string {
  const lines: string[] = [];
  const name = def.settings.name ?? "StateMachine";
  const states = def.state.states ?? [];
  const events = collectEventIds(def);

  lines.push(`"""Generated by SMCraft"""`);
  lines.push(`from enum import Enum, auto`);
  lines.push(`from smcraft.runtime import Context, State, TransitionHelper`);
  lines.push(``);
  lines.push(`class StateId(Enum):`);
  for (const s of collectStateNames(def.state)) {
    lines.push(`    ${s} = auto()`);
  }
  lines.push(``);

  for (const s of states) {
    lines.push(`class State${s.name}(State):`);
    lines.push(`    """State: ${s.name}"""`);
    if (s.onEntry)
      lines.push(
        `    def on_entry(self, context):\n        ${s.onEntry}`
      );
    if (s.onExit)
      lines.push(
        `    def on_exit(self, context):\n        ${s.onExit}`
      );
    for (const t of s.transitions ?? []) {
      lines.push(`    def on_${t.event.toLowerCase()}(self, context):`);
      if (t.condition) lines.push(`        if not (${t.condition}): return`);
      if (t.nextState)
        lines.push(
          `        TransitionHelper.do_transition(context, context.state_${t.nextState.toLowerCase()})`
        );
      else lines.push(`        pass  # internal transition`);
    }
    lines.push(``);
  }

  lines.push(`class ${name}Context(Context):`);
  lines.push(`    """Context for ${name}"""`);
  lines.push(`    def __init__(self):`);
  lines.push(`        super().__init__()`);
  for (const s of states) {
    lines.push(
      `        self.state_${s.name.toLowerCase()} = State${s.name}()`
    );
  }
  lines.push(
    `        self.state_initial = self.state_${(states[0]?.name ?? "Root").toLowerCase()}`
  );
  lines.push(``);

  return lines.join("\n");
}

function generateTypeScriptFallback(def: Definition): string {
  const lines: string[] = [];
  const name = def.settings.name ?? "StateMachine";
  const states = def.state.states ?? [];

  lines.push(`/** Generated by SMCraft */`);
  lines.push(`import { Context, State, TransitionHelper } from "smcraft/runtime";`);
  lines.push(``);
  lines.push(`export enum StateId {`);
  for (const s of collectStateNames(def.state)) {
    lines.push(`  ${s} = "${s}",`);
  }
  lines.push(`}`);
  lines.push(``);

  for (const s of states) {
    lines.push(`export class State${s.name} extends State {`);
    for (const t of s.transitions ?? []) {
      lines.push(`  on${t.event}(context: ${name}Context): void {`);
      if (t.condition) lines.push(`    if (!(${t.condition})) return;`);
      if (t.nextState)
        lines.push(
          `    TransitionHelper.doTransition(context, (context as any).state${t.nextState});`
        );
      lines.push(`  }`);
    }
    lines.push(`}`);
    lines.push(``);
  }

  lines.push(`export class ${name}Context extends Context {`);
  for (const s of states) {
    lines.push(`  state${s.name} = new State${s.name}();`);
  }
  if (states.length > 0)
    lines.push(`  stateInitial = this.state${states[0].name};`);
  lines.push(`}`);

  return lines.join("\n");
}

// ─── RISE rispec generator ───────────────────────────────────────────
// Reverse-Engineering → Intent → Specifications → Exportation.
// Reads the SMDF (and optionally its source PDE) and emits a markdown
// rispec following the workspace's spec conventions:
//   Title → Tagline → Desired Outcome → Structural Tension →
//   States/Events/Transitions → Action Steps → Exportation.

interface PdeSource {
  prompt?: string;
  primary?: { action?: string; target?: string; urgency?: string; confidence?: number };
  secondary?: Array<{ action?: string; target?: string; confidence?: number }>;
  directions?: {
    east?: Array<{ text: string; confidence?: number }>;
    south?: Array<{ text: string; confidence?: number }>;
    west?: Array<{ text: string; confidence?: number }>;
    north?: Array<{ text: string; confidence?: number }>;
  };
  actionStack?: Array<{ text: string; direction?: string; completed?: boolean }>;
  ambiguities?: Array<{ text: string; suggestion?: string }>;
}

function loadPde(def: Definition): PdeSource | null {
  const folder = def.settings._source?.pdeFolder;
  const id = def.settings._source?.pdeId;
  if (!folder || !id) return null;
  const root = resolve(PROJECT_FILE, "..");
  const candidates = [
    resolve(root, folder, `pde-${id}.json`),
    resolve(folder, `pde-${id}.json`),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      return {
        prompt: data.prompt,
        primary: data.result?.primary,
        secondary: data.result?.secondary,
        directions: data.result?.directions,
        actionStack: data.result?.actionStack,
        ambiguities: data.result?.ambiguities,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

function generateRispec(def: Definition, intent?: string): string {
  const pde = loadPde(def);
  const name = def.settings.name;
  const ns = def.settings.namespace;
  const lines: string[] = [];
  const states = def.state.states ?? [];

  const tagline =
    intent ??
    pde?.primary?.target ??
    def.settings._source?.originalPrompt ??
    `${name} state machine`;

  lines.push(`# ${name} — RISE rispec`);
  lines.push("");
  lines.push(`> ${tagline}`);
  lines.push("");
  lines.push(`**Namespace:** \`${ns}\` · **Async:** ${def.settings.asynchronous}`);
  if (def.settings._source?.pdeId) {
    lines.push(`**Source PDE:** \`${def.settings._source.pdeId}\``);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Reverse Engineering
  lines.push("## R — Reverse Engineering");
  lines.push("");
  lines.push(
    `${name} is modeled as a state machine with ${collectStateNames(def.state).length - 1} non-root states across ${depth(def.state)} level(s) of composition. ` +
      `Events: ${collectEventIds(def).length}. Transitions: ${countTransitions(def.state)}.`
  );
  lines.push("");
  if (pde?.prompt) {
    lines.push(`Originating prompt:`);
    lines.push("");
    lines.push(`> ${pde.prompt}`);
    lines.push("");
  }

  // Intent
  lines.push("## I — Intent");
  lines.push("");
  lines.push("**Desired Outcome**");
  lines.push("");
  lines.push(intent ?? pde?.primary?.target ?? "_(no intent supplied — pass `intent` arg or set _source.originalPrompt)_");
  lines.push("");
  if (pde?.directions?.east?.length) {
    lines.push("**Vision (🌅 East)**");
    lines.push("");
    for (const v of pde.directions.east) lines.push(`- ${v.text}`);
    lines.push("");
  }
  lines.push("**Structural Tension**");
  lines.push("");
  lines.push(`- *Current:* ${currentReality(def, pde)}`);
  lines.push(`- *Desired:* ${desiredOutcome(def, pde, intent)}`);
  lines.push("");

  // Specifications
  lines.push("## S — Specifications");
  lines.push("");
  lines.push("### States");
  lines.push("");
  for (const s of states) {
    renderStateSpec(s, lines, 0);
  }
  lines.push("");

  lines.push("### Events");
  lines.push("");
  for (const src of def.events) {
    if (!src.events?.length) continue;
    lines.push(`**${src.name}**`);
    for (const e of src.events) {
      lines.push(`- \`${e.id}\`${e.description ? ` — ${e.description}` : ""}`);
    }
    lines.push("");
  }

  lines.push("### Transitions (flat)");
  lines.push("");
  for (const t of collectTransitions(def.state)) {
    const arrow = t.next ? `→ ${t.next}` : "→ (internal)";
    lines.push(`- \`${t.from}\` --[${t.event}]-- ${arrow}${t.condition ? ` *(when: ${t.condition})*` : ""}`);
  }
  lines.push("");

  // Action Steps (medicine-wheel walk if South/East/North/West present)
  const mw = states.filter((s) => ["East", "South", "West", "North"].includes(s.name));
  if (mw.length || pde?.actionStack?.length) {
    lines.push("### Action Steps");
    lines.push("");
    if (mw.length) {
      const order = ["South", "East", "North", "West"];
      for (const dirName of order) {
        const dir = states.find((s) => s.name === dirName);
        if (!dir) continue;
        lines.push(`**${glyph(dirName)} ${dirName}** — ${dir.description ?? ""}`);
        for (const c of dir.states ?? []) {
          lines.push(`1. ${c.description ?? c.name}`);
        }
        lines.push("");
      }
    } else if (pde?.actionStack?.length) {
      for (const a of pde.actionStack) {
        lines.push(`- *(${a.direction ?? "?"})* ${a.text}`);
      }
      lines.push("");
    }
  }

  // Ambiguities surfaced from PDE
  if (pde?.ambiguities?.length) {
    lines.push("### Open Questions");
    lines.push("");
    for (const a of pde.ambiguities) {
      lines.push(`- ${a.text}${a.suggestion ? `  \n  → *${a.suggestion}*` : ""}`);
    }
    lines.push("");
  }

  // Exportation
  lines.push("## E — Exportation");
  lines.push("");
  lines.push("- Code: `generate_code` (python | typescript) — runtime stubs from this SMDF");
  lines.push(`- Visual: open this file in the smcraft web designer with \`SMCRAFT_PROJECT_FILE=${PROJECT_FILE}\``);
  lines.push("- SMDF: `get_definition` returns the canonical JSON");
  lines.push("");

  return lines.join("\n");
}

function depth(s: StateDef, d = 0): number {
  if (!s.states?.length) return d;
  return Math.max(...s.states.map((c) => depth(c, d + 1)));
}

function countTransitions(s: StateDef): number {
  let n = s.transitions?.length ?? 0;
  for (const c of s.states ?? []) n += countTransitions(c);
  return n;
}

function collectTransitions(
  s: StateDef
): Array<{ from: string; event: string; next?: string; condition?: string }> {
  const out: Array<{ from: string; event: string; next?: string; condition?: string }> = [];
  for (const t of s.transitions ?? []) {
    out.push({ from: s.name, event: t.event, next: t.nextState, condition: t.condition });
  }
  for (const c of s.states ?? []) out.push(...collectTransitions(c));
  return out;
}

function renderStateSpec(s: StateDef, lines: string[], depthLevel: number): void {
  const indent = "  ".repeat(depthLevel);
  const kind = s.kind && s.kind !== "normal" ? ` *(${s.kind})*` : "";
  lines.push(`${indent}- **${s.name}**${kind}${s.description ? ` — ${s.description}` : ""}`);
  for (const t of s.transitions ?? []) {
    lines.push(`${indent}  - on \`${t.event}\` ${t.nextState ? `→ \`${t.nextState}\`` : "(internal)"}`);
  }
  for (const c of s.states ?? []) renderStateSpec(c, lines, depthLevel + 1);
}

function currentReality(def: Definition, _pde: PdeSource | null): string {
  const hasFinal = collectAllStates(def.state).some((s) => s.kind === "final");
  return hasFinal
    ? `${def.settings.name} is designed but not implemented; entry state defined, terminal state reachable in principle.`
    : `${def.settings.name} is partially modeled; no terminal state declared yet.`;
}

function collectAllStates(s: StateDef): StateDef[] {
  const out = [s];
  for (const c of s.states ?? []) out.push(...collectAllStates(c));
  return out;
}

function desiredOutcome(def: Definition, pde: PdeSource | null, intent?: string): string {
  if (intent) return intent;
  if (pde?.primary?.target) return pde.primary.target;
  return `${def.settings.name} runs the modeled flow end-to-end and reaches its terminal state.`;
}

function glyph(direction: string): string {
  return { South: "🔥", East: "🌅", North: "❄️", West: "🌊" }[direction] ?? "•";
}

// ─── MCP Server ──────────────────────────────────────────────────────

const server = new McpServer({
  name: "smcraft-mcp",
  version: "0.1.0",
});

// Tools

server.tool(
  "create_state_machine",
  "Create a new state machine definition with namespace and name",
  { namespace: z.string(), name: z.string(), asynchronous: z.boolean().optional() },
  async ({ namespace, name, asynchronous }) => {
    const def = createEmpty(namespace, name);
    if (asynchronous) def.settings.asynchronous = true;
    writeDef(def);
    bridgeEmitFull(def);
    return {
      content: [
        {
          type: "text",
          text: `Created state machine '${name}' in namespace '${namespace}' → ${PROJECT_FILE}. Add states and events next.`,
        },
      ],
    };
  }
);

server.tool(
  "add_state",
  "Add a state to the state machine. Parent defaults to Root.",
  {
    name: z.string(),
    parent: z.string().optional(),
    kind: z.enum(["normal", "final", "history"]).optional(),
    description: z.string().optional(),
  },
  async ({ name, parent, kind, description }) => {
    const def = readDef();
    if (!def)
      return {
        content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}. Use create_state_machine first.` }],
        isError: true,
      };
    const parentName = parent ?? "Root";
    const parentState = findState(def.state, parentName);
    if (!parentState)
      return {
        content: [{ type: "text", text: `Parent state '${parentName}' not found.` }],
        isError: true,
      };
    if (!parentState.states) parentState.states = [];
    parentState.states.push({ name, kind: kind ?? "normal", description });
    writeDef(def);
    bridgeEmitPatch([
      { op: "state.add", parent: parentName, state: { name, kind: kind ?? "normal", description } },
    ]);
    return {
      content: [{ type: "text", text: `Added state '${name}' under '${parentName}' (${kind ?? "normal"}).` }],
    };
  }
);

server.tool(
  "add_event",
  "Add an event to the state machine",
  { id: z.string(), description: z.string().optional() },
  async ({ id, description }) => {
    const def = readDef();
    if (!def)
      return {
        content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }],
        isError: true,
      };
    const source = def.events[0];
    source.events.push({ id, description });
    writeDef(def);
    bridgeEmitPatch([{ op: "event.add", sourceIndex: 0, event: { id, description } }]);
    return {
      content: [{ type: "text", text: `Added event '${id}'.` }],
    };
  }
);

server.tool(
  "add_transition",
  "Add a transition to a state, triggered by an event",
  {
    state: z.string(),
    event: z.string(),
    nextState: z.string().optional(),
    condition: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ state, event, nextState, condition, description }) => {
    const def = readDef();
    if (!def)
      return {
        content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }],
        isError: true,
      };
    const target = findState(def.state, state);
    if (!target)
      return {
        content: [{ type: "text", text: `State '${state}' not found.` }],
        isError: true,
      };
    if (!target.transitions) target.transitions = [];
    target.transitions.push({ event, nextState, condition, description });
    writeDef(def);
    bridgeEmitPatch([
      { op: "transition.add", state, transition: { event, nextState, condition, description } },
    ]);
    const desc = nextState ? `${state} --[${event}]--> ${nextState}` : `${state} --[${event}]--> (internal)`;
    return { content: [{ type: "text", text: `Added transition: ${desc}` }] };
  }
);

server.tool(
  "remove_state",
  "Remove a state from the definition",
  { name: z.string() },
  async ({ name }) => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    if (name === "Root")
      return { content: [{ type: "text", text: "Cannot remove Root state." }], isError: true };
    def.state = removeState(def.state, name);
    writeDef(def);
    bridgeEmitPatch([{ op: "state.remove", name }]);
    return { content: [{ type: "text", text: `Removed state '${name}'.` }] };
  }
);

server.tool(
  "validate_definition",
  "Validate the current state machine definition against all rules",
  {},
  async () => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    const errors = validate(def);
    if (errors.length === 0)
      return { content: [{ type: "text", text: "✓ Definition is valid. No errors found." }] };
    const lines = errors.map((e) => `[${e.ruleId}] ${e.message}`).join("\n");
    return {
      content: [{ type: "text", text: `Found ${errors.length} validation error(s):\n${lines}` }],
    };
  }
);

server.tool(
  "generate_code",
  "Generate Python or TypeScript code from the current definition",
  { language: z.enum(["python", "typescript"]) },
  async ({ language }) => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    const errors = validate(def);
    if (errors.length > 0) {
      const lines = errors.map((e) => `[${e.ruleId}] ${e.message}`).join("\n");
      return {
        content: [{ type: "text", text: `Fix validation errors first:\n${lines}` }],
        isError: true,
      };
    }
    const code = generateViaSmcg(def, language);
    return { content: [{ type: "text", text: code }] };
  }
);

server.tool(
  "get_definition",
  "Get the current state machine definition as JSON",
  {},
  async () => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ stateMachine: def }, null, 2) }],
    };
  }
);

server.tool(
  "load_definition",
  "Load a state machine definition from JSON",
  { json: z.string() },
  async ({ json }) => {
    try {
      const parsed = JSON.parse(json);
      const def: Definition = parsed.stateMachine ?? parsed.StateMachine ?? parsed;
      writeDef(def);
      bridgeEmitFull(def);
      const stateCount = collectStateNames(def.state).length;
      const eventCount = collectEventIds(def).length;
      return {
        content: [
          {
            type: "text",
            text: `Loaded definition → ${PROJECT_FILE}: ${def.settings.name} (${stateCount} states, ${eventCount} events)`,
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `Invalid JSON: ${e}` }], isError: true };
    }
  }
);

server.tool(
  "list_states",
  "List all states in the current definition with their kind and transitions",
  {},
  async () => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    const lines: string[] = [];
    const walk = (state: StateDef, depth: number) => {
      const indent = "  ".repeat(depth);
      const kind = state.kind ? ` (${state.kind})` : "";
      const transCount = state.transitions?.length ?? 0;
      lines.push(`${indent}${state.name}${kind} — ${transCount} transition(s)`);
      for (const t of state.transitions ?? []) {
        lines.push(`${indent}  → [${t.event}] → ${t.nextState ?? "(internal)"}`);
      }
      (state.states ?? []).forEach((s) => walk(s, depth + 1));
    };
    walk(def.state, 0);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "list_events",
  "List all events in the current definition",
  {},
  async () => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    const events = def.events.flatMap((src) =>
      src.events.map((e) => `${e.id}${e.description ? ` — ${e.description}` : ""}`)
    );
    if (events.length === 0)
      return { content: [{ type: "text", text: "No events defined yet." }] };
    return { content: [{ type: "text", text: events.join("\n") }] };
  }
);

server.tool(
  "generate_rispec",
  "Generate a RISE rispec (markdown) from the current state machine. If the SMDF was sourced from a PDE (settings._source.pdeId/pdeFolder), the PDE's intent, directions, and ambiguities are folded in. Pass `intent` to override the desired outcome.",
  { intent: z.string().optional() },
  async ({ intent }) => {
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: `No state machine at ${PROJECT_FILE}.` }], isError: true };
    const md = generateRispec(def, intent);
    return { content: [{ type: "text", text: md }] };
  }
);

// Resources

server.resource("definition", "smcraft://definition", async () => {
  const def = readDef();
  return {
    contents: [
      {
        uri: "smcraft://definition",
        mimeType: "application/json",
        text: def
          ? JSON.stringify({ stateMachine: def }, null, 2)
          : `{"error": "No definition at ${PROJECT_FILE}"}`,
      },
    ],
  };
});

// Prompts

server.prompt(
  "design-state-machine",
  "Guided conversation to design a state machine step by step",
  { domain: z.string().optional(), name: z.string().optional() },
  ({ domain, name }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to design a state machine${name ? ` called "${name}"` : ""}${domain ? ` for the "${domain}" domain` : ""}. Guide me through:
1. First, create the state machine with create_state_machine
2. Help me identify the key states and add them with add_state
3. Define the events that trigger transitions with add_event
4. Wire up transitions between states with add_transition
5. Validate the design with validate_definition
6. Generate code with generate_code

Start by asking me about the states and events I need.`,
        },
      },
    ],
  })
);

// Start

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SMCraft MCP server running on stdio (project file: ${PROJECT_FILE})`);

  // Best-effort, non-blocking bridge join. Failure never blocks tool handling.
  if (bridge) {
    bridge
      .join()
      .then(() => {
        console.error(`[smcraft-mcp] bridge connected (${process.env.SMCRAFT_BRIDGE_URL})`);
      })
      .catch((e) => {
        console.error("[smcraft-mcp] bridge join failed (continuing standalone):", e?.message ?? e);
      });
  }
}

main().catch(console.error);
