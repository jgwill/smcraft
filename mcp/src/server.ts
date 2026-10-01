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
 *   - render_diagram: Draw the machine as an image on disk and return it
 *   - get_definition: Get the current definition as JSON
 *   - load_definition: Load a definition from JSON
 *   - list_states: List all states in the current definition
 *   - list_events: List all events in the current definition
 *   - set_project_file: Choose which document is active — .smdf.json (state
 *     machine), .erdf.json (ERD), .sqdf.json (sequence) or .sysdf.json (system)
 *   - get_project_file: Report the active document path and bridge status
 *
 * The active document's type is its extension, and the tools for each type
 * refuse to write over another type.
 *
 * ERD tools (Spec 80, ./erd.ts):
 *   - create_erd, add_entity, update_entity, add_attribute, add_relationship
 *   - remove_entity, remove_attribute, remove_relationship
 *   - validate_erd, check_links
 *
 * Sequence tools (Spec 81, ./sequence.ts) — a usage scenario:
 *   - create_sequence, add_participant, update_participant, remove_participant
 *   - add_message, update_message, remove_message, move_message
 *   - add_fragment, add_fragment_message, remove_fragment, validate_sequence
 *
 * System tools (Spec 82, ./system.ts) — the drawings of one thing, together:
 *   - create_system, add_member, remove_member, add_actor, remove_actor
 *   - set_reconcile_mode, check_system, replay_scenario, reconcile_scenario
 *   - show: tell the canvases on a system which member and element to show
 *   In reconcile mode auto, each sequence edit also updates the machines, the
 *   ERD and the system it implies (./live.ts pushes the changes to their rooms).
 *
 * Notes (every document type): set_notes, get_notes — what a person or an
 * agent wrote down about the diagram or one of its shapes, saved in the file.
 *   get_definition, load_definition, render_diagram and check_links answer for
 *   the active document's type; generate_rispec also writes a system's rispec.
 *
 * Resources:
 *   - smcraft://definition — Current state machine definition
 *
 * Prompts:
 *   - design-state-machine — Guided state machine design conversation
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { execFileSync, spawn } from "child_process";
import {
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
  realpathSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "os";
import { createBridgeClient, type BridgeClient } from "@miadi/stateloom-client";
import {
  collectNotes,
  docKindOfPath,
  envAlias,
  isErdfPath,
  isSqdfPath,
  isSysdfPath,
  type EntityRelationshipDefinition,
  type PatchOp,
  type SequenceDefinition,
  type StateMachineDefinition,
  normalizeNotes,
} from "@miadi/stateloom-protocol";
import { renderDiagramToFile, defaultOutputPath } from "@miadi/stateloom-cli/render";
import { resolveProjectSwitch } from "./projectSwitch.js";
import {
  registerErdTools,
  erdSummary,
  erdGetDefinition,
  erdLoadDefinition,
  erdRender,
  erdGetNotes,
  erdSetNotes,
  formatNotes,
  type ErdHost,
} from "./erd.js";
import {
  registerSequenceTools,
  sequenceSummary,
  sequenceGetDefinition,
  sequenceLoadDefinition,
  sequenceRender,
  sequenceGetNotes,
  sequenceSetNotes,
  type SequenceHost,
} from "./sequence.js";
import {
  registerSystemTools,
  checkSystemReport,
  reconcileAfterEdit,
  reconcileModeLine,
  systemSummary,
  systemGetDefinition,
  systemLoadDefinition,
  systemRender,
  systemGetNotes,
  systemSetNotes,
  systemRispec,
  type SystemHost,
} from "./system.js";
import { liveBridge } from "./live.js";

// STATELOOM_* read first, SMCRAFT_* legacy twin honored — the live MCP
// registration bakes SMCRAFT_PROJECT_FILE and must keep working (2026-07-27
// rename brief). Resolved once at boot, like the direct reads they replace.
const BRIDGE_URL = envAlias("BRIDGE_URL");
const AGENT_NAME = envAlias("AGENT_NAME");
const BRIDGE_TOKEN = envAlias("BRIDGE_TOKEN");

// The canvas address for a document (chart_1785683055671): when the agent
// re-points the loom, the human gets a link to LOOK at the same document —
// the `?doc=` parameter is resolved and allowlist-guarded by the web side.
const CANVAS_URL =
  envAlias("CANVAS_URL") ?? `http://127.0.0.1:${envAlias("WEB_PORT") ?? "4598"}`;
const canvasLink = (path: string): string =>
  `${CANVAS_URL}/?doc=${encodeURIComponent(path)}`;

// ─── In-memory state machine definition ──────────────────────────────

interface StateDef {
  name: string;
  kind?: "normal" | "final" | "history";
  description?: string;
  notes?: string;
  /** What an agent resolves while the machine is in this state; engines and codegen ignore it. */
  prompt?: string;
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
    notes?: string;
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
// Both web/ and mcp/ resolve the same path from STATELOOM_PROJECT_FILE
// (legacy twin SMCRAFT_PROJECT_FILE still honored).
// Web reads/writes via /api/file; mcp reads/writes here. fs.watch on
// the web side broadcasts disk changes back to the canvas.

// Mutable: `set_project_file` lets the agent re-point the loom at another
// .smdf.json document mid-session (the hub keys live rooms by this path).
let PROJECT_FILE = resolve(
  envAlias("PROJECT_FILE") ?? "./statemachine.smdf.json"
);

const KIND_WORDS = { machine: "a state machine", erd: "an ERD", sequence: "a sequence", system: "a system" } as const;

/** What the state-machine tools say when there is no machine to act on. */
function noMachine(then = ""): string {
  const kind = docKindOfPath(PROJECT_FILE);
  if (kind === "machine") return `No state machine at ${PROJECT_FILE}.${then}`;
  return `The active document ${PROJECT_FILE} is ${KIND_WORDS[kind]}, not a state machine. Use the ${kind === "erd" ? "ERD" : kind} tools on it, or set_project_file to a .smdf.json document.`;
}

function readDef(): Definition | null {
  // An ERD, a sequence or a system is not a machine; the state-machine tools see no definition there.
  if (docKindOfPath(PROJECT_FILE) !== "machine") return null;
  if (!existsSync(PROJECT_FILE)) return null;
  try {
    const raw = readFileSync(PROJECT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeNotes(parsed.stateMachine ?? parsed.StateMachine ?? parsed);
  } catch (e) {
    console.error(`[smcraft-mcp] Failed to read ${PROJECT_FILE}:`, e);
    return null;
  }
}

function writeDef(def: Definition): void {
  // Never write a machine over an ERD, a sequence or a system: create_state_machine
  // and load_definition write without reading first, so this is the one place that can refuse.
  if (docKindOfPath(PROJECT_FILE) !== "machine") throw new Error(noMachine());
  // Keep the file's own shape: a machine written bare stays bare, so one edit is
  // a small diff and not the whole file re-indented under `stateMachine`.
  let bare = false;
  try {
    const current = JSON.parse(readFileSync(PROJECT_FILE, "utf8"));
    bare = !!current && typeof current === "object" && "state" in current && !("stateMachine" in current) && !("StateMachine" in current);
  } catch {
    // A new or unreadable file is written in the loom's own shape.
  }
  writeFileSync(PROJECT_FILE, JSON.stringify(bare ? def : { stateMachine: def }, null, 2) + (bare ? "\n" : ""), "utf8");
}

// ─── Optional real-time design bridge (env-gated, best-effort) ───────
// When STATELOOM_BRIDGE_URL (or legacy SMCRAFT_BRIDGE_URL) is set, each
// mutation is mirrored to the bridge
// hub so a live web canvas updates as the agent edits. Fully backward-
// compatible: the file on disk remains the durable truth, every bridge
// call is wrapped so any failure degrades to a no-op, and standalone
// operation (no bridge URL) is untouched.

let bridge: BridgeClient | undefined;
if (!BRIDGE_URL) {
  console.error(
    "[smcraft-mcp] STATELOOM_BRIDGE_URL is not set — edits persist to disk but " +
      "are NOT broadcast; a live canvas will not update. Set STATELOOM_BRIDGE_URL " +
      "(legacy twin: SMCRAFT_BRIDGE_URL; e.g. http://127.0.0.1:4599) on this MCP " +
      "process to go live."
  );
}

/** (Re)create the bridge client bound to `docId`, dropping any previous one. */
function bindBridge(docId: string): void {
  if (!BRIDGE_URL) return;
  try {
    bridge?.disconnect();
  } catch {
    /* best-effort */
  }
  try {
    bridge = createBridgeClient({
      url: BRIDGE_URL,
      role: "agent",
      docId,
      name: AGENT_NAME ?? "mcp-agent",
      token: BRIDGE_TOKEN,
    });
  } catch (e) {
    console.error("[smcraft-mcp] bridge init failed (continuing standalone):", e);
    bridge = undefined;
  }
}

/** Best-effort, non-blocking join. Failure never blocks tool handling. */
function joinBridge(): void {
  if (!bridge) return;
  bridge
    .join()
    .then(() => {
      console.error(
        `[smcraft-mcp] bridge connected (${BRIDGE_URL}) docId=${PROJECT_FILE}`
      );
    })
    .catch((e) => {
      console.error("[smcraft-mcp] bridge join failed (continuing standalone):", e?.message ?? e);
    });
}

bindBridge(PROJECT_FILE);

if (BRIDGE_URL) {
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
      (bridge ? `status=${bridge.status}` : "not configured (STATELOOM_BRIDGE_URL unset)") +
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

// What ./erd.ts needs of this server's state. Called at tool time, after the
// guards further down this file are initialised.
const erdHost: ErdHost = {
  projectFile: () => PROJECT_FILE,
  switchTo: (path) => {
    const denial = denyProjectSwitch(path);
    if (denial) return denial;
    PROJECT_FILE = path;
    bindBridge(PROJECT_FILE);
    joinBridge();
    return undefined;
  },
  emitFull: (def: EntityRelationshipDefinition) => bridgeEmitFull(def as unknown as Definition),
  outsideRoot: (path) => outsideRoot(path),
  // From a sequence or a system, the links are the whole system's: check_system.
  checkSystem: async () => checkSystemReport(systemHost),
};

// Pushes to rooms other than the active document's: a reconciled machine, an
// ERD, a view on a system. Each is a short-lived client of its own (./live.ts).
const live = liveBridge({ url: BRIDGE_URL, token: BRIDGE_TOKEN, name: AGENT_NAME ?? "mcp-agent" });

// The system this server last created, set or checked — where `show` and the
// system tools go when neither an argument nor the active document names one.
let LAST_SYSTEM: string | undefined = isSysdfPath(PROJECT_FILE) ? PROJECT_FILE : undefined;

const systemHost: SystemHost = {
  projectFile: () => PROJECT_FILE,
  outsideRoot: (path) => outsideRoot(path),
  emitFull: (def) => bridgeEmitFull(def as Definition),
  live,
  reconcileOverride: () => envAlias("RECONCILE"),
  validateMachine: (def) => validate(def as unknown as Definition),
  machineSpec: (def, level) => machineSpecLines(def as unknown as Definition, level),
  lastSystem: () => LAST_SYSTEM,
  rememberSystem: (path) => {
    LAST_SYSTEM = path;
  },
};

const sequenceHost: SequenceHost = {
  projectFile: () => PROJECT_FILE,
  switchTo: (path) => erdHost.switchTo(path),
  emitFull: (def: SequenceDefinition) => bridgeEmitFull(def as unknown as Definition),
  outsideRoot: (path) => outsideRoot(path),
  afterEdit: (path) => reconcileAfterEdit(systemHost, path),
};

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
  lines.push(`from stateloom.runtime import Context, State, TransitionHelper`);
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
  lines.push(
    `import { Context, State, TransitionHelper } from "@miadi/stateloom-engine/runtime";`
  );
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
  lines.push(...machineSpecLines(def, 3));

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
  lines.push(`- Visual: open this file in the stateloom web designer with \`STATELOOM_PROJECT_FILE=${PROJECT_FILE}\``);
  lines.push("- SMDF: `get_definition` returns the canonical JSON");
  lines.push("");

  return lines.join("\n");
}

/**
 * A machine's states, events and flat transitions as markdown, headings at
 * `level` — the Specifications of a machine's rispec, and each machine's
 * Behaviour in a system's rispec.
 */
function machineSpecLines(def: Definition, level: number): string[] {
  const h = "#".repeat(level);
  const lines: string[] = [];
  lines.push(`${h} States`);
  lines.push("");
  for (const s of def.state?.states ?? []) {
    renderStateSpec(s, lines, 0);
  }
  lines.push("");

  lines.push(`${h} Events`);
  lines.push("");
  for (const src of def.events ?? []) {
    if (!src.events?.length) continue;
    lines.push(`**${src.name}**`);
    for (const e of src.events) {
      lines.push(`- \`${e.id}\`${e.description ? ` — ${e.description}` : ""}`);
    }
    lines.push("");
  }

  lines.push(`${h} Transitions (flat)`);
  lines.push("");
  for (const t of def.state ? collectTransitions(def.state) : []) {
    const arrow = t.next ? `→ ${t.next}` : "→ (internal)";
    lines.push(`- \`${t.from}\` --[${t.event}]-- ${arrow}${t.condition ? ` *(when: ${t.condition})*` : ""}`);
  }
  lines.push("");
  return lines;
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
  if (s.prompt?.trim()) {
    lines.push(`${indent}  - *the agent resolves here:*`);
    for (const line of s.prompt.trim().split("\n")) lines.push(`${indent}    > ${line}`);
  }
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

/**
 * Build a fully-registered server instance.
 *
 * A factory rather than a singleton because one `McpServer` can only be
 * initialized once: a second client sending `initialize` to the same instance
 * is refused, so a shared instance can serve exactly one caller for the life of
 * the process. Stdio still builds exactly one and behaves as it always has;
 * HTTP builds one per request, which is the SDK's stateless pattern and what
 * lets more than one agent reach the same loom.
 *
 * Every tool closes over module-level state (PROJECT_FILE, the bridge client),
 * so instances are interchangeable — building one is registration, not state.
 */
/**
 * The version a client sees in `serverInfo`, read from the manifest that npm
 * actually shipped rather than typed in beside it. The literal here said 0.2.0
 * while the package on the registry was 0.2.2 — two releases during which every
 * agent that asked this server who it was got a confident wrong answer, and no
 * test could catch it because the two numbers had no relationship to compare.
 * Reading the manifest gives them one.
 */
const PACKAGE_VERSION: string = (() => {
  try {
    const manifest = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return String(JSON.parse(readFileSync(manifest, "utf8")).version);
  } catch {
    return "0.0.0-unknown";
  }
})();

function buildServer(): McpServer {
const server = new McpServer({
  name: "stateloom-mcp",
  version: PACKAGE_VERSION,
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
  "Add a state to the state machine. Parent defaults to Root. `prompt` is what an agent is asked to resolve while the machine is in this state (see set_prompt).",
  {
    name: z.string(),
    parent: z.string().optional(),
    kind: z.enum(["normal", "final", "history"]).optional(),
    description: z.string().optional(),
    prompt: z.string().optional(),
  },
  async ({ name, parent, kind, description, prompt }) => {
    const def = readDef();
    if (!def)
      return {
        content: [{ type: "text", text: noMachine(" Use create_state_machine first.") }],
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
    const added: StateDef = { name, kind: kind ?? "normal", description, ...(prompt?.trim() ? { prompt } : {}) };
    parentState.states.push(added);
    writeDef(def);
    bridgeEmitPatch([
      { op: "state.add", parent: parentName, state: { name, kind: kind ?? "normal", description, ...(added.prompt ? { prompt: added.prompt } : {}) } },
    ]);
    return {
      content: [{ type: "text", text: `Added state '${name}' under '${parentName}' (${kind ?? "normal"}).` }],
    };
  }
);

server.tool(
  "update_state",
  "Change what a state says about itself without rewriting the machine: its description, its kind (normal, final, history) or its prompt. Omitted fields stay as they are; an empty description or prompt clears it. Use it after a scenario built states in auto mode, to say what each one is.",
  {
    name: z.string(),
    description: z.string().optional(),
    kind: z.enum(["normal", "final", "history"]).optional(),
    prompt: z.string().optional(),
  },
  async ({ name, description, kind, prompt }) => {
    const def = readDef();
    if (!def) return { content: [{ type: "text", text: noMachine() }], isError: true };
    const target = findState(def.state, name);
    if (!target) return { content: [{ type: "text", text: `State '${name}' not found.` }], isError: true };
    const patch: Record<string, string> = {};
    const said: string[] = [];
    if (description !== undefined) {
      if (description.trim()) target.description = description;
      else delete target.description;
      patch.description = description;
      said.push(description.trim() ? "description" : "description cleared");
    }
    if (kind !== undefined) {
      target.kind = kind;
      patch.kind = kind;
      said.push(`kind ${kind}`);
    }
    if (prompt !== undefined) {
      if (prompt.trim()) target.prompt = prompt;
      else delete target.prompt;
      patch.prompt = prompt.trim() ? prompt : "";
      said.push(prompt.trim() ? "prompt" : "prompt cleared");
    }
    if (!said.length) return { content: [{ type: "text", text: `Nothing to change on '${name}': give a description, a kind or a prompt.` }], isError: true };
    writeDef(def);
    bridgeEmitPatch([{ op: "state.update", name, patch }]);
    return { content: [{ type: "text", text: `Updated '${name}': ${said.join(", ")}.` }] };
  }
);

server.tool(
  "update_event",
  "Change an event's description without rewriting the machine. An empty description clears it.",
  { id: z.string(), description: z.string() },
  async ({ id, description }) => {
    const def = readDef();
    if (!def) return { content: [{ type: "text", text: noMachine() }], isError: true };
    const event = (def.events ?? []).flatMap((s) => s.events ?? []).find((e) => e.id === id);
    if (!event) return { content: [{ type: "text", text: `Event '${id}' not found.` }], isError: true };
    if (description.trim()) event.description = description;
    else delete event.description;
    writeDef(def);
    bridgeEmitPatch([{ op: "event.update", id, patch: { description } }]);
    return { content: [{ type: "text", text: description.trim() ? `Described event '${id}'.` : `Cleared the description of '${id}'.` }] };
  }
);

server.tool(
  "set_prompt",
  "Say what an agent is asked to resolve while the machine is in a state: the instruction it receives when the state is entered — an opening message, the frame of every later turn. `description` says what the state is and notes are the conversation about it; the prompt is what to do in it. The text replaces what was there; an empty string clears it. Engines and code generation ignore it; get_definition and generate_rispec show it.",
  { state: z.string(), prompt: z.string() },
  async ({ state, prompt }) => {
    const def = readDef();
    if (!def) return { content: [{ type: "text", text: noMachine() }], isError: true };
    const target = findState(def.state, state);
    if (!target) return { content: [{ type: "text", text: `State '${state}' not found.` }], isError: true };
    if (prompt.trim()) target.prompt = prompt;
    else delete target.prompt;
    writeDef(def);
    bridgeEmitPatch([{ op: "state.update", name: state, patch: { prompt: prompt.trim() ? prompt : "" } }]);
    return {
      content: [{ type: "text", text: prompt.trim() ? `Prompt set on '${state}' (${prompt.length} characters).` : `Prompt cleared on '${state}'.` }],
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
        content: [{ type: "text", text: noMachine() }],
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
        content: [{ type: "text", text: noMachine() }],
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
      return { content: [{ type: "text", text: noMachine() }], isError: true };
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
      return { content: [{ type: "text", text: noMachine() }], isError: true };
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
      return { content: [{ type: "text", text: noMachine() }], isError: true };
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
  "Get the active document as JSON — a state machine, or the ERD, sequence or system when the active document is a .erdf.json, .sqdf.json or .sysdf.json",
  {},
  async () => {
    if (isErdfPath(PROJECT_FILE)) return erdGetDefinition(erdHost);
    if (isSqdfPath(PROJECT_FILE)) return sequenceGetDefinition(sequenceHost);
    if (isSysdfPath(PROJECT_FILE)) return systemGetDefinition(systemHost);
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: noMachine() }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ stateMachine: def }, null, 2) }],
    };
  }
);

server.tool(
  "load_definition",
  "Load a definition from JSON into the active document — a state machine, or an ERD, a sequence or a system when the active document is a .erdf.json, .sqdf.json or .sysdf.json",
  { json: z.string() },
  async ({ json }) => {
    if (isErdfPath(PROJECT_FILE)) return erdLoadDefinition(erdHost, json);
    if (isSqdfPath(PROJECT_FILE)) return sequenceLoadDefinition(sequenceHost, json);
    if (isSysdfPath(PROJECT_FILE)) return systemLoadDefinition(systemHost, json);
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
      return { content: [{ type: "text", text: noMachine() }], isError: true };
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
      return { content: [{ type: "text", text: noMachine() }], isError: true };
    const events = def.events.flatMap((src) =>
      src.events.map((e) => `${e.id}${e.description ? ` — ${e.description}` : ""}`)
    );
    if (events.length === 0)
      return { content: [{ type: "text", text: "No events defined yet." }] };
    return { content: [{ type: "text", text: events.join("\n") }] };
  }
);

server.tool(
  "set_project_file",
  "Choose the active document the loom weaves — two modalities. STANDALONE: a path whose extension says what it is: .smdf.json (a state machine), .erdf.json (an ERD — the ERD tools act on it), .sqdf.json (a sequence — the sequence tools act on it) or .sysdf.json (a system — the system tools, check_system and show act on it). RELATIONAL: a chronicle address `miadi-chronicle://<episode>/<diagram>` resolving over $MIADI_CHRONICLE_ROOT to <episode-dir>/diagrams/<diagram>.smdf.json; name another type by its extension (`miadi-chronicle://103/flow.sqdf.json`) — an ambiguous episode number is a hard error naming the candidates. Disk persistence AND the live bridge room both re-point. A missing file is legitimate — naming it is how an episode's first diagram is created.",
  { path: z.string() },
  async ({ path }) => {
    try {
      const r = resolveProjectSwitch(path, PROJECT_FILE);
      const denial = denyProjectSwitch(r.path);
      if (denial) return { content: [{ type: "text", text: denial }], isError: true };
      PROJECT_FILE = r.path;
      if (!r.unchanged) {
        bindBridge(PROJECT_FILE);
        joinBridge();
      }
      if (isSysdfPath(PROJECT_FILE)) LAST_SYSTEM = PROJECT_FILE;
      const def = r.exists ? readDef() : null;
      const summary = [
        isErdfPath(PROJECT_FILE)
          ? erdSummary(PROJECT_FILE)
          : isSqdfPath(PROJECT_FILE)
            ? sequenceSummary(PROJECT_FILE)
            : isSysdfPath(PROJECT_FILE)
              ? systemSummary(PROJECT_FILE)
              : def
                ? `existing machine '${def.settings.name}' (${collectStateNames(def.state).length} states, ${collectEventIds(def).length} events)`
                : r.exists
                  ? "file exists but is not a readable definition"
                  : "no file yet — create_state_machine or load_definition will write it",
        reconcileModeLine(systemHost, PROJECT_FILE),
      ]
        .filter(Boolean)
        .join("\n");
      const bridgeNote = BRIDGE_URL
        ? r.unchanged
          ? `bridge unchanged (${bridge?.status ?? "not configured"})`
          : `bridge re-joining room '${r.path}'`
        : "bridge not configured (STATELOOM_BRIDGE_URL unset)";
      return {
        content: [
          {
            type: "text",
            text: `Active document: ${r.path}\nPrevious: ${r.previous}\n${summary}\n${bridgeNote}\nCanvas: ${canvasLink(r.path)}`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_project_file",
  "Report the active document's path and what it is (a .smdf.json state machine, .erdf.json ERD, .sqdf.json sequence or .sysdf.json system), whether it exists on disk, the reconcile mode for a sequence or a system, and live-bridge status",
  {},
  async () => {
    const def = readDef();
    const summary = [
      isErdfPath(PROJECT_FILE)
        ? erdSummary(PROJECT_FILE)
        : isSqdfPath(PROJECT_FILE)
          ? sequenceSummary(PROJECT_FILE)
          : isSysdfPath(PROJECT_FILE)
            ? systemSummary(PROJECT_FILE)
            : def
              ? `machine '${def.settings.name}' (${collectStateNames(def.state).length} states, ${collectEventIds(def).length} events)`
              : existsSync(PROJECT_FILE)
                ? "file exists but is not a readable definition"
                : "file does not exist yet",
      reconcileModeLine(systemHost, PROJECT_FILE),
    ]
      .filter(Boolean)
      .join("\n");
    const bridgeNote = BRIDGE_URL
      ? `bridge: ${bridge?.status ?? "not initialized"} → ${BRIDGE_URL}`
      : "bridge not configured (STATELOOM_BRIDGE_URL unset)";
    return {
      content: [
        { type: "text", text: `Active document: ${PROJECT_FILE}\n${summary}\n${bridgeNote}\nCanvas: ${canvasLink(PROJECT_FILE)}` },
      ],
    };
  }
);

server.tool(
  "generate_rispec",
  "Generate a RISE rispec (markdown) from the current state machine. If the SMDF was sourced from a PDE (settings._source.pdeId/pdeFolder), the PDE's intent, directions, and ambiguities are folded in. Pass `intent` to override the desired outcome. When the active document is a system (.sysdf.json), or `system` names one, the rispec is the whole system's: Creative Intent, Data from its ERDs, Behaviour per machine, each scenario path as a Creative Advancement Scenario (from the replay), and Open questions. Returns markdown; writes nothing.",
  { intent: z.string().optional(), system: z.string().optional() },
  async ({ intent, system }) => {
    if (system || isSysdfPath(PROJECT_FILE)) return systemRispec(systemHost, { system, intent });
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: noMachine() }], isError: true };
    const md = generateRispec(def, intent);
    return { content: [{ type: "text", text: md }] };
  }
);

/**
 * How large a PNG may be and still ride back inside the tool result. Past this
 * the agent gets the path alone — a multi-megabyte base64 blob would crowd out
 * the conversation it was meant to illustrate.
 */
const INLINE_IMAGE_LIMIT = 1_500_000;

/** Hand a rendered file to the platform viewer. Never fatal — a server has none. */
function openOnDesktop(path: string): string {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(opener, [path], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
    return `opened with ${opener}`;
  } catch {
    return "no desktop opener available";
  }
}

server.tool(
  "render_diagram",
  "Draw the current state machine as a picture. Writes the file next to the project document (or at `path`) and returns its absolute path — plus the image itself for png, so it can be looked at without leaving the conversation. Formats: png (raster, needs librsvg/Inkscape/ImageMagick/Chrome on the host), svg (needs nothing), mermaid, ascii. Pass stamp:true to keep every render instead of overwriting one file. An ERD renders as mermaid (<name>.erd.mmd), a sequence as mermaid (<name>.seq.mmd), and a system as one markdown file of its members' mermaid (<name>.sys.md).",
  {
    format: z.enum(["png", "svg", "mermaid", "ascii"]).optional(),
    path: z.string().optional(),
    scale: z.number().optional(),
    theme: z.enum(["dark", "light"]).optional(),
    stamp: z.boolean().optional(),
    open: z.boolean().optional(),
  },
  async ({ format, path, scale, theme, stamp, open }) => {
    if (isErdfPath(PROJECT_FILE)) return erdRender(erdHost, { format, path, stamp });
    if (isSqdfPath(PROJECT_FILE)) return sequenceRender(sequenceHost, { format, path, stamp });
    if (isSysdfPath(PROJECT_FILE)) return systemRender(systemHost, { format, path, stamp });
    const def = readDef();
    if (!def)
      return {
        content: [{ type: "text", text: noMachine() }],
        isError: true,
      };

    const chosen = format ?? "png";
    if (path) {
      // A render writes state names — free text the caller chose — into a file
      // the caller named. Under a document root that is exactly the write that
      // has to stay inside it.
      const denial = outsideRoot(path);
      if (denial) return { content: [{ type: "text", text: denial }], isError: true };
    }
    try {
      const result = await renderDiagramToFile(def as unknown as StateMachineDefinition, {
        format: chosen,
        out: path,
        doc: PROJECT_FILE,
        scale,
        theme,
        stamp,
      });

      const size = result.width && result.height ? `, ${result.width}×${result.height}` : "";
      const how = result.backend ? `, drawn by ${result.backend}` : "";
      const opened = open ? ` — ${openOnDesktop(result.path)}` : "";
      const note = `Rendered '${def.settings.name}' → ${result.path} (${result.bytes} bytes${size}${how})${opened}`;

      // png and svg come back as pictures; the text formats are already text.
      if (chosen === "png" && result.bytes <= INLINE_IMAGE_LIMIT) {
        return {
          content: [
            { type: "text", text: note },
            {
              type: "image",
              data: readFileSync(result.path).toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      }
      if (chosen === "mermaid" || chosen === "ascii") {
        return {
          content: [
            { type: "text", text: note },
            { type: "text", text: readFileSync(result.path, "utf8") },
          ],
        };
      }
      return { content: [{ type: "text", text: note }] };
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return {
        content: [
          {
            type: "text",
            text:
              `render_diagram (${chosen}) failed: ${why}\n` +
              `An SVG needs no rasterizer — retry with format "svg" ` +
              `(it would land at ${defaultOutputPath(PROJECT_FILE, "svg")}).`,
          },
        ],
        isError: true,
      };
    }
  }
);

registerErdTools(server, erdHost);
registerSequenceTools(server, sequenceHost);
registerSystemTools(server, systemHost);

// Notes — the same two tools for either document type.

server.tool(
  "set_notes",
  "Save working notes on the active diagram or on one of its shapes — what was said about it, an open question, a decision — so whoever opens the document next (a person or an agent) finds them. Omit `target` for the whole diagram; otherwise `target` is a state name (state machine), an entity name (ERD), a participant name, a message ('9', 'f1.2') or 'fragment N' (sequence), or a member's path (system). The text replaces what was there; an empty string clears it. Notes are kept in the document and are not part of the model: engines and code generation ignore them.",
  { target: z.string().optional(), notes: z.string() },
  async ({ target, notes }) => {
    if (isErdfPath(PROJECT_FILE)) return erdSetNotes(erdHost, target, notes);
    if (isSqdfPath(PROJECT_FILE)) return sequenceSetNotes(sequenceHost, target, notes);
    if (isSysdfPath(PROJECT_FILE)) return systemSetNotes(systemHost, target, notes);
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: noMachine() }], isError: true };
    const holder = target ? findState(def.state, target) : def.settings;
    if (!holder)
      return { content: [{ type: "text", text: `State '${target}' not found.` }], isError: true };
    if (notes.trim()) holder.notes = notes;
    else delete holder.notes;
    writeDef(def);
    // "" is how an erased note travels; the far side removes the key.
    const patch = { notes: notes.trim() ? notes : "" };
    bridgeEmitPatch([target ? { op: "state.update", name: target, patch } : { op: "settings.update", patch }]);
    return {
      content: [
        {
          type: "text",
          text: `${notes.trim() ? "Saved" : "Cleared"} the notes on ${target ? `state '${target}'` : "the diagram"}.`,
        },
      ],
    };
  }
);

server.tool(
  "get_notes",
  "Read every note in the active document in one call — the diagram's own first, then each shape that has one. Read them before changing a diagram somebody else has been working on: they are where a person leaves what they were thinking.",
  {},
  async () => {
    if (isErdfPath(PROJECT_FILE)) return erdGetNotes(erdHost);
    if (isSqdfPath(PROJECT_FILE)) return sequenceGetNotes(sequenceHost);
    if (isSysdfPath(PROJECT_FILE)) return systemGetNotes(systemHost);
    const def = readDef();
    if (!def)
      return { content: [{ type: "text", text: noMachine() }], isError: true };
    const entries = collectNotes(def as unknown as StateMachineDefinition);
    return { content: [{ type: "text", text: formatNotes(def.settings.name, PROJECT_FILE, entries) }] };
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

  return server;
}

// ─── Transports ──────────────────────────────────────────────────────
//
// Stdio is the default and is unchanged: no new environment variable, no new
// flag, and this server still boots as a child process beside one agent with
// the parent's trust. Everything below only runs when someone explicitly asks
// for a port, so an existing registration cannot fall into HTTP by accident.
//
// The remote mode is deliberately narrow about what it will do, because the
// two things stdio got for free — one client, and the caller's own filesystem
// trust — are exactly what a port gives away:
//
//   STATELOOM_MCP_HTTP_PORT   the port to bind; unset means stdio (default)
//   STATELOOM_MCP_HTTP_HOST   interface, default 127.0.0.1 — loopback, not 0.0.0.0
//   STATELOOM_MCP_TOKEN       required bearer token; without one, a reachable
//                             port is an unauthenticated write primitive on the
//                             host, so HTTP mode refuses to start
//   STATELOOM_MCP_ROOT        confine every document to this directory
//   STATELOOM_MCP_LOCK_PROJECT  refuse set_project_file outright
//
// What this mode is NOT: multi-tenant. The active document is process state,
// so every HTTP client shares one board — which is the loom's whole premise
// for humans and agents together, and a hazard between strangers. Per-session
// documents need a server instance per session; that is a real change and is
// not pretended at here.

const HTTP_PORT = envAlias("MCP_HTTP_PORT");
const HTTP_HOST = envAlias("MCP_HTTP_HOST") ?? "127.0.0.1";
const HTTP_TOKEN = envAlias("MCP_TOKEN");
const DOC_ROOT = (() => {
  const raw = envAlias("MCP_ROOT");
  if (!raw) return undefined;
  // realpath the root too: comparing a real path against a symlinked root
  // would refuse every legitimate document inside it.
  try {
    return realpathSync(resolve(raw));
  } catch {
    return resolve(raw);
  }
})();
const LOCK_PROJECT = /^(1|true|yes)$/i.test(envAlias("MCP_LOCK_PROJECT") ?? "");

/**
 * Guard for `set_project_file`. Returns a refusal string, or undefined to allow.
 *
 * Unset environment means unset behaviour: with neither a root nor a lock this
 * returns undefined every time, so the stdio path a thousand agents already run
 * behaves exactly as it did.
 */
function denyProjectSwitch(target: string): string | undefined {
  if (LOCK_PROJECT) {
    return `set_project_file is locked on this server (STATELOOM_MCP_LOCK_PROJECT). Active document stays ${PROJECT_FILE}.`;
  }
  return outsideRoot(target);
}

/**
 * Resolve a path the way the filesystem will, not the way the string looks.
 *
 * A lexical `startsWith(root + "/")` refuses `..` and prefix siblings, and is
 * still wrong: `root/link -> /elsewhere` passes the string test and lands
 * outside. So the deepest part of the path that actually exists is put through
 * `realpathSync` — which follows every symlink in it — and the not-yet-created
 * tail is rejoined onto that. A file the caller is about to create inside a
 * symlinked directory is judged by where the directory really is.
 */
function trueResolve(target: string): string {
  let existing = resolve(target);
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(target); // reached the filesystem root
    tail.unshift(basename(existing));
    existing = parent;
  }
  try {
    return join(realpathSync(existing), ...tail);
  } catch {
    return resolve(target);
  }
}

/**
 * Refusal string when `target` falls outside `STATELOOM_MCP_ROOT`, else undefined.
 *
 * Every caller-supplied path goes through here, not just `set_project_file`:
 * `render_diagram` takes a `path` and writes state names into it, which is a
 * file write with attacker-chosen content and was the hole a confined server
 * most needed closed. With no root configured this returns undefined always, so
 * the stdio path is unaffected.
 */
function outsideRoot(target: string): string | undefined {
  if (!DOC_ROOT) return undefined;
  const real = trueResolve(target);
  if (real === DOC_ROOT || real.startsWith(DOC_ROOT + "/")) return undefined;
  return `Refused: ${target} resolves to ${real}, outside the permitted document root ${DOC_ROOT} (STATELOOM_MCP_ROOT).`;
}

/** Constant-time bearer check — a fast string compare leaks the token by timing. */
function authorized(req: IncomingMessage): boolean {
  if (!HTTP_TOKEN) return false;
  const header = req.headers.authorization ?? "";
  const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(offered);
  const b = Buffer.from(HTTP_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Largest body accepted; the biggest legitimate one is a whole definition. */
const BODY_LIMIT = 8 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversize = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      // A body cap keeps an unauthenticated probe from being a memory attack;
      // the largest legitimate payload here is a whole definition.
      if (size > BODY_LIMIT) {
        oversize = true;
        fail(new Error(`request body over ${BODY_LIMIT} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (oversize) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return ok(undefined);
      try {
        ok(JSON.parse(raw));
      } catch {
        fail(new Error("body is not JSON"));
      }
    });
    req.on("error", fail);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

async function startHttp(port: number): Promise<void> {
  if (!HTTP_TOKEN) {
    console.error(
      "Refusing to start HTTP mode without STATELOOM_MCP_TOKEN.\n" +
        "An open port on this server is an unauthenticated way to read and write\n" +
        "files on the host. Set a token, or drop the port and use stdio."
    );
    process.exit(1);
  }

  // A root that does not contain the document it starts on confines nothing:
  // every write tool would land outside it from the first request. Refuse at
  // boot, where it is a config error, rather than at the first surprise.
  const bootDenial = outsideRoot(PROJECT_FILE);
  if (bootDenial) {
    console.error(
      `Refusing to start: STATELOOM_PROJECT_FILE is outside STATELOOM_MCP_ROOT.\n  ${bootDenial}`
    );
    process.exit(1);
  }

  // Stateless, deliberately, and a fresh server+transport per request. The
  // stateful mode binds a session id to one transport and one server instance,
  // and an `McpServer` refuses a second `initialize` — so anything shared here
  // serves exactly one client for the life of the process, which is not what a
  // port is for. Sessions would only earn that cost if they partitioned state,
  // and they do not: the active document is process-global either way.
  const http = createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/health") {
      // Deliberately says nothing about the document. /health is the one
      // unauthenticated route, and the active path is host filesystem layout.
      sendJson(res, 200, { ok: true, transport: "http" });
      return;
    }
    if (path !== "/mcp") {
      sendJson(res, 404, { error: "not found — the MCP endpoint is /mcp" });
      return;
    }
    if (req.method !== "POST") {
      // GET on the MCP endpoint opens a server-push stream this server never
      // has anything to push on: it stays open, pinning a socket and its
      // buffers, and nothing ever closes it. The documented surface is POST.
      res.setHeader("allow", "POST");
      sendJson(res, 405, { error: "method not allowed — POST /mcp" });
      return;
    }
    if (!authorized(req)) {
      res.setHeader("www-authenticate", 'Bearer realm="stateloom-mcp"');
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    readBody(req)
      .then(async (body) => {
        const instance = buildServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        // Tear down with the response, not before it: closing the transport
        // while the reply is still streaming truncates it.
        res.on("close", () => {
          void transport.close().catch(() => {});
          void instance.close().catch(() => {});
        });
        await instance.connect(transport);
        await transport.handleRequest(req, res, body);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[stateloom-mcp] request failed:", message);
        if (res.headersSent) return;
        const tooBig = message.includes("request body over");
        sendJson(res, tooBig ? 413 : 400, { error: message });
        req.destroy();
      });
  });

  await new Promise<void>((ok, fail) => {
    http.once("error", fail);
    http.listen(port, HTTP_HOST, () => {
      http.removeListener("error", fail);
      ok();
    });
  }).catch((err: NodeJS.ErrnoException) => {
    const why =
      err.code === "EADDRINUSE"
        ? `port ${port} is already in use on ${HTTP_HOST}`
        : err.code === "EACCES"
          ? `not allowed to bind ${HTTP_HOST}:${port}`
          : (err.message ?? String(err));
    console.error(`stateloom-mcp could not start: ${why}`);
    process.exit(1);
  });

  console.error(
    `stateloom-mcp on http://${HTTP_HOST}:${port}/mcp (project file: ${PROJECT_FILE})` +
      (DOC_ROOT ? `\n  documents confined to ${DOC_ROOT}` : "") +
      (LOCK_PROJECT ? `\n  set_project_file locked` : "") +
      (HTTP_HOST === "0.0.0.0"
        ? `\n  WARNING: bound to every interface — put a TLS terminator in front of this.`
        : "")
  );

  const close = () => {
    http.close();
    bridge?.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

async function main() {
  if (HTTP_PORT) {
    // Whole-string match: parseInt("8080abc") is 8080, which would bind a port
    // nobody asked for. Zero is rejected too — the OS would pick an ephemeral
    // port while the banner printed ":0", leaving a server nobody can reach.
    if (!/^[0-9]{1,5}$/.test(HTTP_PORT.trim())) {
      console.error(`STATELOOM_MCP_HTTP_PORT is not a port number: ${HTTP_PORT}`);
      process.exit(1);
    }
    const port = Number.parseInt(HTTP_PORT.trim(), 10);
    if (port < 1 || port > 65535) {
      console.error(`STATELOOM_MCP_HTTP_PORT out of range (1-65535): ${HTTP_PORT}`);
      process.exit(1);
    }
    await startHttp(port);
  } else {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    console.error(`stateloom-mcp running on stdio (project file: ${PROJECT_FILE})`);
  }
  joinBridge();
}

main().catch(console.error);
