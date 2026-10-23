/**
 * The system half of the MCP server (Spec 82).
 *
 * A system (`.sysdf.json`) names the drawings of one thing being built — its
 * ERDs, its machines, its scenarios — and the actors its scenarios share. The
 * tools here edit it, check every name that crosses between its members, replay
 * a scenario through the machines, and reconcile the members from a scenario.
 *
 * Reconcile mode (`settings.reconcile`, overridden for a session by
 * STATELOOM_RECONCILE): in `propose`, a sequence edit reports in one line what
 * the scenario implies for the other members; in `auto`, the edit applies it —
 * machines are written and patched live, ERDs and the system are written and
 * sent whole — and reports in one line what changed.
 *
 * Which system: the `system` argument, else the active document when it is a
 * `.sysdf.json`, else the system that lists the sequence (or member) at hand —
 * the last one this server created, set or checked, or one beside it — else the
 * last system. Which sequence: the `sequence` argument, else the active document
 * when it is a `.sqdf.json`. A sequence no system lists is checked, replayed and
 * reconciled against the machines (and ERDs) beside it.
 *
 * Everything that touches the server's own state comes in through `SystemHost`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { writeFileAtomic } from "./atomicWrite.js";
import { basename, dirname, join, resolve } from "path";
import {
  RECONCILE_MODES,
  SYSTEM_ACTOR_KINDS,
  addActor,
  addMember,
  checkSystem,
  docKindOfPath,
  emptySystem,
  formatReplay,
  isSqdfPath,
  isSysdfPath,
  isSystemDefinition,
  machineName,
  membersByKind,
  parseFocus,
  parseMessageRef,
  reconcileModeOf,
  reconcileSystem,
  relativeMemberPath,
  removeActor,
  removeMember,
  renderMermaid,
  renderMermaidEr,
  renderMermaidSequence,
  replayScenario,
  resolveMemberPath,
  setReconcileMode,
  stateOfList,
  summarizeReconcile,
  summarizeSystem,
  updateMember,
  updateSystemSettings,
  type EntityRelationshipDefinition,
  type LoadedMember,
  type PatchOp,
  type ReconcileMode,
  type ReplayPath,
  type ReplayStep,
  type SequenceDefinition,
  type StateMachineDefinition,
  type SystemActorKind,
  type SystemDefinition,
  type SystemIssue,
  type SystemReconcile,
  normalizeNotes
} from "@miadi/stateloom-protocol";
import { stampedOutputPath } from "@miadi/stateloom-cli/render";
import { formatNotes } from "./erd.js";
import type { Live, LiveOutcome } from "./live.js";

export interface SystemHost {
  /** The active document's absolute path. */
  projectFile(): string;
  /** The refusal for a path outside the permitted document root, if any. */
  outsideRoot(path: string): string | undefined;
  /** Mirror a document to the server's own room (it is the active document). Best-effort. */
  emitFull(def: unknown): void;
  /** Pushes to other rooms: a reconciled machine, an ERD, a view. */
  live: Live;
  /** STATELOOM_RECONCILE, when set: wins over every system's own mode for this session. */
  reconcileOverride(): string | undefined;
  /** A machine's own V rules — the validator behind validate_definition. */
  validateMachine(def: StateMachineDefinition): { ruleId: string; message: string }[];
  /** A machine's states, events and transitions as markdown, headings at `level` — generate_rispec's content. */
  machineSpec(def: StateMachineDefinition, level: number): string[];
  /** The system this server last created, set or checked. */
  lastSystem(): string | undefined;
  rememberSystem(path: string): void;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const STOPPED: readonly ReplayStep["result"][] = ["refused", "unknown-event", "ended", "state-mismatch"];

// ─── Disk ────────────────────────────────────────────────────────────

export function readSystem(path: string): SystemDefinition | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = normalizeNotes(JSON.parse(readFileSync(path, "utf8")));
    return isSystemDefinition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(path: string, doc: unknown): void {
  writeFileAtomic(path, JSON.stringify(doc, null, 2) + "\n");
}

/** Write a machine back in the shape its file had: wrapped in `stateMachine` (or `StateMachine`), or bare. */
function writeMachine(path: string, def: StateMachineDefinition): void {
  let wrapper: string | null = null;
  let rest: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if ("stateMachine" in parsed) wrapper = "stateMachine";
    else if ("StateMachine" in parsed) wrapper = "StateMachine";
    if (wrapper) rest = parsed;
  } catch {
    /* a new file is written bare */
  }
  writeJson(path, wrapper ? { ...rest, [wrapper]: def } : def);
}

const mtimeOf = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Date.now();
  }
};

/**
 * Read one member as `checkSystem` wants it. A machine is unwrapped from
 * `{ stateMachine }`. A member outside the document root is not read at all,
 * and a file that is not JSON is said to be so — its content is never quoted.
 */
function loadMember(host: SystemHost, path: string, absolute: string): LoadedMember {
  const kind = docKindOfPath(path);
  if (host.outsideRoot(absolute)) {
    return { path, kind, def: null, error: "it is outside the permitted document root (STATELOOM_MCP_ROOT), so it was not read" };
  }
  if (!existsSync(absolute)) return { path, kind, def: null, error: `no file at ${absolute}` };
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (e) {
    return { path, kind, def: null, error: `the file cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})` };
  }
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { path, kind, def: null, error: "it is not valid JSON" };
  }
  const def = normalizeNotes(kind === "machine" ? (parsed?.stateMachine ?? parsed?.StateMachine ?? parsed) : parsed);
  return { path, kind, def };
}

/** One line for set_project_file / get_project_file when the active document is a system. */
export function systemSummary(path: string): string {
  const def = readSystem(path);
  if (def) {
    const count = (kind: string) => def.members.filter((m) => docKindOfPath(m.path) === kind).length;
    return (
      `existing system '${def.settings?.name ?? ""}' (${def.members.length} members: ${count("machine")} machine(s), ` +
      `${count("erd")} ERD(s), ${count("sequence")} sequence(s); ${(def.actors ?? []).length} actors)`
    );
  }
  return existsSync(path)
    ? "file exists but is not a readable system definition"
    : "no file yet — create_system or load_definition will write it";
}

// ─── Which system, which sequence ────────────────────────────────────

const lists = (systemPath: string, system: SystemDefinition, absolute: string): boolean =>
  system.members.some((m) => resolveMemberPath(systemPath, m.path) === absolute);

/** `systemPath` is a readable system inside the document root that lists `absolute`. */
function listedBy(host: SystemHost, systemPath: string, absolute: string): boolean {
  if (host.outsideRoot(systemPath)) return false;
  const s = readSystem(systemPath);
  return !!s && lists(systemPath, s, absolute);
}

/**
 * The system that lists `absolute`: the last system when it does, else the
 * nearest `.sysdf.json` that does, in the document's own folder and then each
 * parent folder up to the document root (or `/`).
 */
function systemFor(host: SystemHost, absolute: string): string | undefined {
  const last = host.lastSystem();
  if (last && listedBy(host, last, absolute)) return last;
  let dir = dirname(absolute);
  while (!host.outsideRoot(dir)) {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter(isSysdfPath).sort();
    } catch {
      /* an unreadable folder lists nothing */
    }
    for (const f of names) if (listedBy(host, join(dir, f), absolute)) return join(dir, f);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

interface Scope {
  systemPath?: string;
  system: SystemDefinition | null;
  sequencePath?: string;
  members: LoadedMember[];
  /** A member path as the scope writes it → absolute. */
  absolute(member: string): string;
  /** How the report names what was checked. */
  label: string;
}

function resolveScope(host: SystemHost, args: { sequence?: string; system?: string }): Scope | string {
  const active = host.projectFile();
  const sequencePath = args.sequence ? resolve(args.sequence) : isSqdfPath(active) ? active : undefined;
  if (sequencePath && !isSqdfPath(sequencePath)) return `A sequence document ends in .sqdf.json (got '${sequencePath}').`;
  let systemPath: string | undefined;
  if (args.system) {
    systemPath = resolve(args.system);
  } else if (sequencePath) {
    // A sequence belongs to the system that lists it. The active system is used
    // only when it does: another system's machines must not learn its events.
    systemPath = isSysdfPath(active) && listedBy(host, active, sequencePath) ? active : systemFor(host, sequencePath);
  } else if (isSysdfPath(active)) {
    systemPath = active;
  } else {
    systemPath = systemFor(host, active) ?? host.lastSystem();
  }
  if (systemPath && !isSysdfPath(systemPath)) return `A system document ends in .sysdf.json (got '${systemPath}').`;
  for (const p of [systemPath, sequencePath]) {
    const denial = p ? host.outsideRoot(p) : undefined;
    if (denial) return denial;
  }

  if (systemPath) {
    const sysPath = systemPath;
    const system = readSystem(sysPath);
    if (!system) {
      return existsSync(sysPath)
        ? `${sysPath} is not a readable system definition.`
        : `No system at ${sysPath}. Use create_system first.`;
    }
    host.rememberSystem(sysPath);
    const members = system.members.map((m) => loadMember(host, m.path, resolveMemberPath(sysPath, m.path)));
    if (sequencePath && !lists(sysPath, system, sequencePath)) members.push(loadMember(host, sequencePath, sequencePath));
    return {
      systemPath: sysPath,
      system,
      sequencePath,
      members,
      absolute: (p) => resolveMemberPath(sysPath, p),
      label: `system '${system.settings?.name ?? ""}' (${sysPath})`,
    };
  }

  if (sequencePath) {
    if (!existsSync(sequencePath)) return `No sequence at ${sequencePath}.`;
    const dir = dirname(sequencePath);
    const beside = readdirSync(dir)
      .filter((f) => /\.(smdf|erdf)\.json$/i.test(f))
      .sort()
      .map((f) => join(dir, f));
    return {
      system: null,
      sequencePath,
      members: [loadMember(host, sequencePath, sequencePath), ...beside.map((p) => loadMember(host, p, p))],
      absolute: (p) => p,
      label: `sequence ${basename(sequencePath)} with the machines and ERDs beside it (no system lists it)`,
    };
  }

  return "No system or sequence at hand: pass `system` (a .sysdf.json) or `sequence` (a .sqdf.json), or set_project_file to one.";
}

/**
 * The system a system-editing tool (and `show`) acts on: the argument, else the
 * active document when it is a system, else the system that lists the active
 * document, else the last system this server created, set or checked.
 */
function systemPathOf(host: SystemHost, arg?: string): string | { error: string } {
  const active = host.projectFile();
  const path = arg ? resolve(arg) : isSysdfPath(active) ? active : (systemFor(host, active) ?? host.lastSystem());
  if (!path) return { error: "No system at hand: pass `system` (a .sysdf.json), set_project_file to one, or create_system." };
  if (!isSysdfPath(path)) return { error: `A system document ends in .sysdf.json (got '${path}').` };
  const denial = host.outsideRoot(path);
  return denial ? { error: denial } : path;
}

// ─── Reconcile mode ──────────────────────────────────────────────────

function modeOf(host: SystemHost, system: SystemDefinition | null): { mode: ReconcileMode; how: string } {
  const override = host.reconcileOverride();
  const mode = reconcileModeOf(system, override);
  if (override === "auto" || override === "propose") return { mode, how: " (STATELOOM_RECONCILE, for this session)" };
  if (override) return { mode, how: ` (STATELOOM_RECONCILE='${override}' ignored: auto or propose)` };
  return { mode, how: "" };
}

/** The mode that applies to a scope: auto writes only within a system, never into files a sequence merely sits beside. */
function scopeMode(host: SystemHost, system: SystemDefinition | null): { mode: ReconcileMode; how: string; withheld: boolean } {
  const m = modeOf(host, system);
  if (m.mode === "auto" && !system) {
    return { mode: "propose", how: " (auto applies only within a system, and no system lists this sequence)", withheld: true };
  }
  return { ...m, withheld: false };
}

/** The reconcile line for get_project_file: a system's mode, or the mode of the system that lists a sequence. */
export function reconcileModeLine(host: SystemHost, path: string): string | undefined {
  if (!isSysdfPath(path) && !isSqdfPath(path)) return undefined;
  const systemPath = isSysdfPath(path) ? path : systemFor(host, path);
  const { mode, how, withheld } = scopeMode(host, systemPath ? readSystem(systemPath) : null);
  const where = !isSqdfPath(path) || withheld ? "" : systemPath ? ` — system ${systemPath}` : " — no system lists this sequence";
  return `reconcile: ${mode}${how}${where}`;
}

const opLine = (op: PatchOp): string => {
  switch (op.op) {
    case "event.add":
      return `+ event ${op.event.id} (source ${op.sourceIndex + 1})`;
    case "eventSource.add":
      return `+ event source ${op.source.name} with ${(op.source.events ?? []).map((e) => e.id).join(", ") || "no event"}`;
    case "state.add":
      return `+ state ${op.state.name} under ${op.parent ?? "the root"}`;
    case "transition.add":
      return `+ transition ${op.state} --[${op.transition.event}]--> ${op.transition.nextState ?? "(internal)"}`;
    case "settings.update":
      return `~ settings ${Object.keys(op.patch).join(", ")}`;
    default:
      return op.op;
  }
};

interface Applied {
  /** One line per document, written or not. */
  lines: string[];
  /** `<name> +<changes>` for each document written. */
  written: string[];
  /** `<name> (<why>)` for each document that could not be written. */
  failed: string[];
  /** Live pushes that failed (a hub that is not configured is not a failure). */
  notLive: string[];
}

/**
 * Write every change a reconcile found, one document at a time, then mirror it:
 * a machine's ops are patched to its room, an ERD and the system are sent whole.
 * A document that cannot be written is reported and the others still are; the
 * file stands whatever the hub does.
 */
async function applyReconcile(host: SystemHost, scope: Scope, r: SystemReconcile): Promise<Applied> {
  const out: Applied = { lines: [], written: [], failed: [], notLive: [] };
  const one = async (
    who: string,
    where: string,
    changes: number,
    what: string,
    path: string,
    write: () => void,
    push: () => Promise<LiveOutcome>,
  ): Promise<void> => {
    if (host.outsideRoot(path)) {
      out.failed.push(`${who} (outside the document root)`);
      out.lines.push(`${who} (${where}): NOT written — it is outside the permitted document root`);
      return;
    }
    try {
      write();
    } catch (e) {
      out.failed.push(`${who} (${message(e)})`);
      out.lines.push(`${who} (${where}): NOT written — ${message(e)}`);
      return;
    }
    out.written.push(`${who} +${changes}`);
    const live = await push().catch((e): LiveOutcome => ({ ok: false, text: `not live: ${message(e)}` }));
    if (!live.ok && !live.off) out.notLive.push(`${who}: ${live.text}`);
    out.lines.push(`${who} (${where}): wrote ${what} — ${live.text}`);
  };

  for (const m of r.machines) {
    const path = scope.absolute(m.member);
    await one(m.machine, m.member, m.reasons.length, `${m.ops.length} op(s)`, path, () => writeMachine(path, m.def), () =>
      host.live.patch(path, m.ops, m.def, mtimeOf(path)),
    );
  }
  for (const e of r.erds) {
    const path = scope.absolute(e.member);
    await one(e.def.settings?.name ?? e.member, e.member, e.reasons.length, `${e.reasons.length} change(s)`, path, () => writeJson(path, e.def), () =>
      host.live.full(path, e.def, mtimeOf(path)),
    );
  }
  if (r.system && scope.systemPath) {
    const path = scope.systemPath;
    const def = r.system.def;
    await one("system", basename(path), r.system.reasons.length, `${r.system.reasons.length} change(s)`, path, () => writeJson(path, def), async () => {
      if (path !== host.projectFile()) return host.live.full(path, def, mtimeOf(path));
      host.emitFull(def);
      return { ok: true, text: "mirrored to the active room" };
    });
  }
  return out;
}

/**
 * After a sequence edit (sequence.ts `afterEdit`): reconcile the system that
 * lists it, and return the ONE line the edit's result carries. In auto mode the
 * changes are applied; in propose mode — or when no system lists the sequence —
 * they are counted.
 */
export async function reconcileAfterEdit(host: SystemHost, sequencePath: string): Promise<string | undefined> {
  const scope = resolveScope(host, { sequence: sequencePath });
  if (typeof scope === "string") return undefined;
  const { mode, withheld } = scopeMode(host, scope.system);
  const r = reconcileSystem(scope.system, scope.members);
  if (!r.count && !r.unresolved.length) return undefined;
  const open = r.unresolved.length ? " (see check_system)" : "";
  if (!r.count) return `reconcile ${mode}: ${r.unresolved.length} left open${open}`;
  if (mode === "auto") {
    const a = await applyReconcile(host, scope, r);
    const notLive = a.notLive.length ? `; not live — ${a.notLive.join("; ")}` : "";
    if (!a.failed.length) return `${summarizeReconcile(r, "auto")}${open}${notLive}`;
    const left = r.unresolved.length ? `; ${r.unresolved.length} left open${open}` : "";
    return (
      `auto, partly applied: wrote ${a.written.join(", ") || "nothing"}; NOT written: ${a.failed.join("; ")}` +
      `${left}${notLive} — reconcile_scenario apply:true retries what is missing`
    );
  }
  const next = withheld
    ? " — no system lists this sequence, so auto mode does not apply; reconcile_scenario apply:true writes it"
    : " — reconcile_scenario apply:true, or set_reconcile_mode auto";
  return `${summarizeReconcile(r, "propose")}${open}${next}`;
}

// ─── Reports ─────────────────────────────────────────────────────────

function issueLines(issues: SystemIssue[]): string[] {
  const lines: string[] = [];
  for (const severity of ["error", "warning"] as const) {
    const mine = issues.filter((i) => i.severity === severity);
    if (!mine.length) continue;
    lines.push(`${severity === "error" ? "Errors" : "Warnings"} (${mine.length})`);
    for (const rule of [...new Set(mine.map((i) => i.ruleId))].sort()) {
      const group = mine.filter((i) => i.ruleId === rule);
      lines.push(`  ${rule} ×${group.length}`);
      for (const i of group) lines.push(`    ${i.member ? `${i.member}: ` : ""}${i.message}`);
    }
  }
  return lines;
}

const endOf = (path: ReplayPath): string =>
  Object.entries(path.end)
    .map(([m, s]) => `${m} in ${s.join(" or ") || "no state"}`)
    .join("; ") || "no machine";

function replayLine(scenario: string, path: ReplayPath): string {
  if (path.accepted) return `  ${scenario} · ${path.name}: accepted — ends with ${endOf(path)}`;
  const stop = path.steps.find((s) => STOPPED.includes(s.result))!;
  return `  ${scenario} · ${path.name}: stops at message ${stop.ref} — ${stop.note ?? stop.result}`;
}

function runCheck(host: SystemHost, scope: Scope): { text: string; errors: number } {
  const check = checkSystem(scope.system, scope.members);
  const issues: SystemIssue[] = [...check.issues];
  for (const { member, def } of membersByKind(scope.members).machines) {
    let found: { ruleId: string; message: string }[];
    try {
      found = host.validateMachine(def);
    } catch (e) {
      found = [{ ruleId: "V000", message: `cannot be validated: ${message(e)}` }];
    }
    for (const v of found) issues.push({ ruleId: v.ruleId, message: v.message, severity: "error", member });
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const { mode, how } = scopeMode(host, scope.system);
  const lines = [
    `Checked ${scope.label}: ${errors} error(s), ${warnings} warning(s) across ${scope.members.length} member(s). Reconcile: ${mode}${how}.`,
    ...issueLines(issues),
  ];
  if (check.replays.length) {
    lines.push("Replay");
    for (const { member, report } of check.replays) {
      for (const path of report.paths) lines.push(replayLine(report.scenario || member, path));
    }
  }
  return { text: lines.join("\n"), errors };
}

export function checkSystemReport(host: SystemHost, args: { system?: string; sequence?: string } = {}): ToolResult {
  const scope = resolveScope(host, args);
  if (typeof scope === "string") return fail(scope);
  const { text, errors } = runCheck(host, scope);
  return errors ? fail(text) : ok(text);
}

// ─── The tools that answer by extension (called from server.ts) ──────

export function systemGetDefinition(host: SystemHost): ToolResult {
  const def = readSystem(host.projectFile());
  return def ? ok(JSON.stringify(def, null, 2)) : fail(`No system at ${host.projectFile()}.`);
}

export function systemLoadDefinition(host: SystemHost, json: string): ToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return fail(`Invalid JSON: ${e}`);
  }
  const path = host.projectFile();
  if (!isSystemDefinition(parsed)) {
    return fail(
      `The active document ${path} is a system, and this JSON is not one (it needs a "members" array, and no "state", "entities" or "participants"). ` +
        `To load another kind of document, set_project_file to a document of that kind first.`,
    );
  }
  writeJson(path, parsed);
  host.emitFull(parsed);
  host.rememberSystem(path);
  return ok(`Loaded system → ${path}: ${summarizeSystem(parsed)}`);
}

/** Every member's mermaid in one markdown file: `<name>.sys.md` beside the system. */
export function systemRender(host: SystemHost, opts: { format?: string; path?: string; stamp?: boolean }): ToolResult {
  const doc = host.projectFile();
  const def = readSystem(doc);
  if (!def) return fail(`No system at ${doc}.`);
  const format = opts.format ?? "mermaid";
  if (format !== "mermaid") {
    return fail(`A system renders as one markdown file of its members' mermaid (asked for ${format}); set_project_file to a member to draw it as svg or png.`);
  }
  if (opts.path) {
    const denial = host.outsideRoot(opts.path);
    if (denial) return fail(denial);
  }
  const out = opts.path
    ? resolve(opts.path)
    : opts.stamp
      ? stampedOutputPath(doc, def.settings?.name, "mermaid", new Date()).replace(/\.mmd$/i, ".md")
      : resolve(doc).replace(/\.sysdf\.json$/i, "") + ".sys.md";
  const lines = [`# ${def.settings?.name ?? ""} — system`, ""];
  if (def.settings?.description) lines.push(def.settings.description, "");
  for (const m of def.members) {
    const loaded = loadMember(host, m.path, resolveMemberPath(doc, m.path));
    const d = loaded.def as Record<string, unknown> | null;
    const name = (d?.settings as { name?: string } | undefined)?.name ?? "";
    lines.push(`## ${loaded.kind}: ${m.path}${name ? ` — ${name}` : ""}`, "");
    if (!d) {
      lines.push(`_cannot be read: ${loaded.error ?? "no content"}_`, "");
      continue;
    }
    try {
      const text =
        loaded.kind === "erd"
          ? renderMermaidEr(d as unknown as EntityRelationshipDefinition)
          : loaded.kind === "sequence"
            ? renderMermaidSequence(d as unknown as SequenceDefinition)
            : renderMermaid(d as unknown as StateMachineDefinition);
      lines.push("```mermaid", text, "```", "");
    } catch (e) {
      lines.push(`_cannot be drawn: ${message(e)}_`, "");
    }
  }
  const text = lines.join("\n");
  writeFileSync(out, text, "utf8");
  return {
    content: [
      { type: "text", text: `Rendered system '${def.settings?.name ?? ""}' (${def.members.length} members) → ${out} (${text.length} bytes)` },
      { type: "text", text },
    ],
  };
}

export function systemGetNotes(host: SystemHost): ToolResult {
  const path = host.projectFile();
  const def = readSystem(path);
  if (!def) return fail(`No system at ${path}.`);
  const entries: { target: string | null; notes: string }[] = [];
  if (def.settings?.notes?.trim()) entries.push({ target: null, notes: def.settings.notes });
  for (const m of def.members) if (m.notes?.trim()) entries.push({ target: m.path, notes: m.notes });
  return ok(formatNotes(def.settings?.name ?? "", path, entries));
}

/** `target` is a member's path (as the system writes it, or absolute); omitted, the whole system. */
export function systemSetNotes(host: SystemHost, target: string | undefined, notes: string): ToolResult {
  const path = host.projectFile();
  const def = readSystem(path);
  if (!def) return fail(`No system at ${path}. Use create_system first.`);
  let next: SystemDefinition;
  if (!target) {
    next = updateSystemSettings(def, { notes });
  } else {
    const want = resolveMemberPath(path, target);
    const hit = def.members.find((m) => resolveMemberPath(path, m.path) === want);
    if (!hit) return fail(`'${target}' is not a member of '${def.settings?.name ?? ""}'. Members: ${def.members.map((m) => m.path).join(", ") || "none"}.`);
    next = updateMember(def, hit.path, { notes: notes.trim() ? notes : "" });
  }
  writeJson(path, next);
  host.emitFull(next);
  return ok(`${notes.trim() ? "Saved" : "Cleared"} the notes on ${target ? `member '${target}'` : "the system"}.`);
}

// ─── generate_rispec for a system ────────────────────────────────────

function scenarioBlock(seq: SequenceDefinition, path: ReplayPath): string[] {
  const name = seq.settings?.name ?? "scenario";
  const L: string[] = [`**Creative Advancement Scenario**: ${path.kind === "main" ? name : `${name} · ${path.name}`}`, ""];
  const last = path.steps.length ? parseMessageRef(seq, path.steps[path.steps.length - 1].ref)?.message : undefined;
  const fragment = path.fragment === undefined ? undefined : seq.fragments?.[path.fragment];
  const desired =
    path.kind === "main" || path.kind === "without-optional"
      ? (seq.settings?.description ?? last?.label ?? "")
      : `when ${fragment?.label ?? path.name}: ${last?.label ?? ""}`;
  L.push(`**Desired Outcome**: ${desired}`, "");

  const start = new Map<string, string[]>();
  for (const s of path.steps) if (s.machine && !start.has(s.machine) && s.from.length) start.set(s.machine, s.from);
  for (const [m, states] of Object.entries(path.end)) if (!start.has(m)) start.set(m, states);
  L.push(
    `**Current Reality**: ${[...start].map(([m, s]) => `${m} in ${s.join(" or ") || "no state"}`).join("; ") || "no member machine"}`,
    "",
  );

  L.push("**Natural Progression**:", "");
  let previous = "";
  for (const s of path.steps) {
    const move =
      s.result === "data"
        ? ""
        : `${s.machine ?? "no machine"}: ${s.from.join("|") || "·"} → ${s.to.join("|") || "·"} (${s.result}${s.guards?.length ? `, assuming ${s.guards.join("; ")}` : ""})`;
    if (s.ref === previous && move) {
      L[L.length - 1] += ` · ${move}`;
      continue;
    }
    previous = s.ref;
    const m = parseMessageRef(seq, s.ref)?.message;
    const head = m ? `${m.from} → ${m.to}: ${m.label}` : s.label;
    const fires = s.event ? ` — fires \`${s.event}\`` : "";
    const then = m?.state ? `, then \`${m.state}\`` : "";
    L.push(`- **${s.ref}.** ${head}${fires}${then}${move ? `; ${move}` : ""}`);
  }
  L.push("");

  const stop = path.steps.find((s) => STOPPED.includes(s.result));
  L.push(
    `**Resolution**: ${endOf(path)}${stop ? ` — the walk stops at message ${stop.ref}: ${stop.note ?? stop.result}` : ""}`,
    "",
  );
  return L;
}

export function systemRispec(host: SystemHost, args: { system?: string; intent?: string }): ToolResult {
  const scope = resolveScope(host, { system: args.system });
  if (typeof scope === "string") return fail(scope);
  if (!scope.system) return fail("generate_rispec for a system needs a .sysdf.json: pass `system`, or set_project_file to one.");
  const sys = scope.system;
  const name = sys.settings?.name ?? "system";
  const { machines, erds, sequences } = membersByKind(scope.members);
  const check = checkSystem(sys, scope.members);
  const reconcile = reconcileSystem(sys, scope.members);
  const intent = args.intent ?? sys.settings?.description;
  const L: string[] = [];

  L.push(`# ${name} — RISE rispec (system)`, "", `> ${intent ?? `${name} system`}`, "");
  L.push(
    `**Namespace:** \`${sys.settings?.namespace ?? ""}\` · **Members:** ${machines.length} machine(s), ${erds.length} ERD(s), ${sequences.length} scenario(s)`,
    "",
    "---",
    "",
  );

  L.push("## Creative Intent", "", intent ?? "_(no description — set the system's description or pass `intent`)_", "");
  if (sys.actors?.length) {
    L.push("**Actors**", "");
    for (const a of sys.actors) L.push(`- **${a.name}** (${a.kind})${a.description ? ` — ${a.description}` : ""}`);
    L.push("");
  }

  L.push("## Data", "");
  if (!erds.length) L.push("_No ERD in this system._", "");
  for (const { member, def } of erds) {
    L.push(`### ${def.settings?.name ?? member} (\`${member}\`)`, "");
    if (def.settings?.description) L.push(def.settings.description, "");
    L.push("**Entities**", "");
    for (const e of def.entities ?? []) {
      L.push(`- **${e.name}**${e.weak ? " *(weak)*" : ""}${e.description ? ` — ${e.description}` : ""}`);
      const keys = (e.attributes ?? [])
        .filter((a) => a.key || a.references || a.stateOf)
        .map(
          (a) =>
            `\`${a.name}\`${a.key ? ` ${a.key}` : ""}${a.references ? ` → ${a.references}` : ""}${a.stateOf ? ` (state of ${stateOfList(a).join(", ")})` : ""}`,
        );
      if (keys.length) L.push(`  - key attributes: ${keys.join(", ")}`);
    }
    L.push("");
    if (def.relationships?.length) {
      L.push("**Relationships**", "");
      for (const r of def.relationships) L.push(`- ${r.from} ${r.cardinality} ${r.to}${r.label ? ` — ${r.label}` : ""}`);
      L.push("");
    }
  }

  L.push("## Behaviour", "");
  if (!machines.length) L.push("_No state machine in this system._", "");
  machines.forEach(({ member, def }, i) => {
    L.push(`### ${machineName(def, i)} (\`${member}\`)`, "");
    if (def.settings?.description) L.push(def.settings.description, "");
    const objects = def.settings?.objects ?? [];
    if (objects.length) L.push(`Objects: ${objects.map((o) => `\`${o.instance}\`: ${o.class}`).join(", ")}`, "");
    L.push(...host.machineSpec(def, 4));
  });

  L.push("## Creative Advancement Scenarios", "");
  if (!sequences.length) L.push("_No scenario in this system._", "");
  for (const { member, def } of sequences) {
    const report = check.replays.find((r) => r.member === member)?.report ?? replayScenario(def, machines.map((m) => m.def));
    L.push(`### ${def.settings?.name ?? member} (\`${member}\`)`, "");
    for (const path of report.paths) L.push(...scenarioBlock(def, path));
  }

  L.push("## Open questions", "");
  const stops = check.issues.filter((i) => i.ruleId === "L008").map((i) => `${i.member ? `${i.member}: ` : ""}${i.message}`);
  if (stops.length) L.push("**Where a scenario and the machines disagree (L008)**", "", ...stops.map((q) => `- ${q}`), "");
  if (reconcile.unresolved.length) {
    L.push("**What reconcile leaves to a person**", "", ...reconcile.unresolved.map((q) => `- ${q}`), "");
  }
  if (!stops.length && !reconcile.unresolved.length) L.push("_None: every scenario path is a walk the machines accept._", "");
  return ok(L.join("\n"));
}

// ─── Tool registration ───────────────────────────────────────────────

/** Read the system a tool acts on, apply `edit`, write, mirror when active, remember, and report. */
function mutateSystem(
  host: SystemHost,
  arg: string | undefined,
  edit: (def: SystemDefinition, path: string) => SystemDefinition,
  report: (def: SystemDefinition, path: string) => string,
): ToolResult {
  const path = systemPathOf(host, arg);
  if (typeof path !== "string") return fail(path.error);
  const def = readSystem(path);
  if (!def) return fail(existsSync(path) ? `${path} is not a readable system definition.` : `No system at ${path}. Use create_system first.`);
  let next: SystemDefinition;
  try {
    next = edit(def, path);
  } catch (e) {
    return fail(message(e));
  }
  writeJson(path, next);
  if (path === host.projectFile()) host.emitFull(next);
  host.rememberSystem(path);
  return ok(report(next, path));
}

/**
 * A member path from a caller: relative to the system file, or absolute; stored
 * relative when beneath it. A member outside the document root is refused.
 */
function memberPathFor(host: SystemHost, systemPath: string, given: string): string {
  const absolute = resolveMemberPath(systemPath, given.trim());
  if (host.outsideRoot(absolute)) {
    throw new Error(`'${given}' is outside the permitted document root (STATELOOM_MCP_ROOT); a system can only hold documents inside it.`);
  }
  return relativeMemberPath(systemPath, absolute);
}

const systemArg = z.string().optional().describe("The .sysdf.json to act on; default the active system, else the system that lists the active document, else the last system");

export function registerSystemTools(server: McpServer, host: SystemHost): void {
  server.tool(
    "create_system",
    "Create a system definition (.sysdf.json): the one document that names the drawings of one thing being built — its ERDs (.erdf.json), machines (.smdf.json) and scenarios (.sqdf.json) — and the actors they share. `members` are paths, relative to the system file or absolute; they are stored relative when beneath it. Without `path` it lands next to the active document as <name>.sysdf.json. The active document does not move. The new system is remembered: the system tools and show use it when neither an argument, the active document, nor a system listing the active document names another. Refuses to replace a system that has members unless overwrite is true.",
    {
      namespace: z.string(),
      name: z.string(),
      description: z.string().optional(),
      path: z.string().optional(),
      members: z.array(z.string()).optional(),
      overwrite: z.boolean().optional(),
    },
    async ({ namespace, name, description, path, members, overwrite }) => {
      const active = host.projectFile();
      const target = resolve(path ?? (isSysdfPath(active) ? active : join(dirname(active), `${name}.sysdf.json`)));
      if (!isSysdfPath(target)) return fail(`A system document ends in .sysdf.json (got '${target}').`);
      const denial = host.outsideRoot(target);
      if (denial) return fail(denial);
      const existing = readSystem(target);
      if (existing && existing.members.length > 0 && !overwrite) {
        return fail(
          `${target} already holds system '${existing.settings?.name ?? ""}' with ${existing.members.length} members. ` +
            `Pass overwrite: true to replace it, or pass system: '${target}' to the system tools to keep working on it.`,
        );
      }
      let def = emptySystem(namespace, name, description);
      const missing: string[] = [];
      try {
        for (const m of members ?? []) {
          const p = memberPathFor(host, target, m);
          def = addMember(def, { path: p });
          if (!existsSync(resolveMemberPath(target, p))) missing.push(p);
        }
      } catch (e) {
        return fail(message(e));
      }
      writeJson(target, def);
      if (target === active) host.emitFull(def);
      host.rememberSystem(target);
      return ok(
        `Created system '${name}' in namespace '${namespace}' → ${target} with ${def.members.length} member(s).` +
          (missing.length ? ` No file yet at: ${missing.join(", ")}.` : "") +
          ` Remembered as this session's system; pass system: to name it explicitly.`,
      );
    },
  );

  server.tool(
    "add_member",
    "Add a drawing to a system: a .erdf.json, .smdf.json or .sqdf.json path, relative to the system file or absolute (stored relative when it is beneath the system's folder). A system is never a member of another.",
    { path: z.string(), notes: z.string().optional(), system: systemArg },
    async ({ path, notes, system }) => {
      let stored = "";
      return mutateSystem(
        host,
        system,
        (def, sys) => {
          stored = memberPathFor(host, sys, path);
          return addMember(def, { path: stored, notes });
        },
        (_def, sys) =>
          `Added member ${docKindOfPath(stored)} '${stored}'${existsSync(resolveMemberPath(sys, stored)) ? "" : " (no file there yet)"}.`,
      );
    },
  );

  server.tool(
    "remove_member",
    "Remove a drawing from a system (the file stays on disk). `path` as the system writes it, relative to the system file, or absolute.",
    { path: z.string(), system: systemArg },
    async ({ path, system }) => {
      let stored = "";
      return mutateSystem(
        host,
        system,
        (def, sys) => {
          const want = resolveMemberPath(sys, path.trim());
          stored = def.members.find((m) => resolveMemberPath(sys, m.path) === want)?.path ?? path;
          return removeMember(def, stored);
        },
        () => `Removed member '${stored}'. The file is untouched.`,
      );
    },
  );

  server.tool(
    "add_actor",
    `Add an actor to a system: someone or something that acts in its scenarios, written once and shared by all of them. kind is one of ${SYSTEM_ACTOR_KINDS.join(", ")}. A sequence participant names it with \`actor\`.`,
    {
      name: z.string(),
      kind: z.enum(SYSTEM_ACTOR_KINDS as [SystemActorKind, ...SystemActorKind[]]),
      description: z.string().optional(),
      wheelNode: z.string().optional().describe("The medicine-wheel node this actor is (node:human:…), when there is one"),
      system: systemArg,
    },
    async ({ system, ...actor }) =>
      mutateSystem(host, system, (def) => addActor(def, actor), () => `Added ${actor.kind} actor '${actor.name}'.`),
  );

  server.tool(
    "remove_actor",
    "Remove an actor from a system. Participants that name it are left in place; check_system names them.",
    { name: z.string(), system: systemArg },
    async ({ name, system }) =>
      mutateSystem(host, system, (def) => removeActor(def, name), () => `Removed actor '${name}'.`),
  );

  server.tool(
    "set_reconcile_mode",
    "Choose how a system answers a scenario edit. propose (the default): each sequence edit says in one line how many changes the scenario implies for the machines, the ERD and the system, and reconcile_scenario apply:true applies them. auto: each sequence edit applies them at once — machines written and patched live, ERDs and the system written — and says in one line what changed. Written to the system's settings.reconcile; STATELOOM_RECONCILE overrides it for a session.",
    { mode: z.enum(RECONCILE_MODES as [ReconcileMode, ...ReconcileMode[]]), system: systemArg },
    async ({ mode, system }) =>
      mutateSystem(
        host,
        system,
        (def) => setReconcileMode(def, mode),
        (def) => {
          const effective = modeOf(host, def);
          return `Reconcile mode of '${def.settings?.name ?? ""}' is now ${mode}.${effective.mode !== mode || effective.how ? ` In force for this session: ${effective.mode}${effective.how}.` : ""}`;
        },
      ),
  );

  server.tool(
    "check_system",
    "Check a system: its own document (Y001–Y004), each member's own rules (E, S, and each machine's V rules), the ERD ↔ machine links (L001–L004), and the scenarios against the machines and the data (L005 events, L006 participants, L007 carried entities, L008 the replay). Reported by rule, errors first, then warnings, then one line per scenario path. With no argument: the active system, else the system that lists the active sequence or member, else the last system.",
    { system: systemArg },
    async ({ system }) => checkSystemReport(host, { system }),
  );

  server.tool(
    "replay_scenario",
    "Walk a scenario through the machines, message by message: for each event, the transition each machine takes, the state it is then in, and where a path stops. Every path is walked — main, without its optional messages, and each fragment. With no sequence: the active sequence, else every sequence of the system. A sequence no system lists is replayed against the machines beside it.",
    { sequence: z.string().optional(), system: z.string().optional() },
    async ({ sequence, system }) => {
      const scope = resolveScope(host, { sequence, system });
      if (typeof scope === "string") return fail(scope);
      const { machines, sequences } = membersByKind(scope.members);
      const chosen = scope.sequencePath
        ? sequences.filter((s) => scope.absolute(s.member) === scope.sequencePath)
        : sequences;
      if (!chosen.length) {
        const loaded = scope.members.find((m) => m.kind === "sequence" && (!scope.sequencePath || scope.absolute(m.path) === scope.sequencePath));
        return fail(loaded?.error ? `${loaded.path} cannot be read: ${loaded.error}` : `No readable sequence in ${scope.label}.`);
      }
      const reports = chosen.map(({ def }) => formatReplay(replayScenario(def, machines.map((m) => m.def))));
      return ok(reports.join("\n\n"));
    },
  );

  server.tool(
    "reconcile_scenario",
    "Bring the drawings level with the scenarios. The scenario says what should happen; reconcile proposes the additions that make it so: events and transitions (and states) on the machines, objects a participant is, entities a message carries or a participant holds on the ERD, actors on the system. With a system at hand, every scenario of the system is reconciled. Nothing is removed or rewritten. Default is a dry run: each change with its reason, and what is left open for a person to decide. apply:true writes each changed file and pushes each machine's ops to its live room, so a canvas open on the machine changes as you watch; if the hub is unreachable the files still stand.",
    { sequence: z.string().optional(), system: z.string().optional(), apply: z.boolean().optional() },
    async ({ sequence, system, apply }) => {
      const scope = resolveScope(host, { sequence, system });
      if (typeof scope === "string") return fail(scope);
      const r = reconcileSystem(scope.system, scope.members);
      const { mode, how } = scopeMode(host, scope.system);
      const head = `Reconcile ${scope.label} — mode ${mode}${how}: ${r.count} change(s), ${r.unresolved.length} left open.`;
      const lines = [head];
      if (!apply) {
        for (const m of r.machines) {
          lines.push(`${m.machine} (${m.member}):`);
          for (const why of m.reasons) lines.push(`  - ${why}`);
          for (const op of m.ops) lines.push(`      ${opLine(op)}`);
        }
        for (const e of r.erds) {
          lines.push(`${e.def.settings?.name ?? e.member} (${e.member}):`);
          for (const why of e.reasons) lines.push(`  - ${why}`);
        }
        if (r.system) {
          lines.push(`system (${scope.systemPath ? basename(scope.systemPath) : ""}):`);
          for (const why of r.system.reasons) lines.push(`  - ${why}`);
        }
      }
      let failed = 0;
      if (apply && r.count) {
        const applied = await applyReconcile(host, scope, r);
        failed = applied.failed.length;
        lines.push("Applied:", ...applied.lines.map((l) => `  ${l}`));
        if (failed) lines.push(`${failed} document(s) NOT written; the others were. Fix the cause and run reconcile_scenario apply:true again.`);
      }
      if (r.unresolved.length) {
        lines.push(`Left open (${r.unresolved.length}):`, ...r.unresolved.map((u) => `  - ${u}`));
      }
      if (!apply && r.count) lines.push("Dry run: nothing was written. Pass apply:true to write it.");
      if (!r.count && !r.unresolved.length) lines.push("The drawings already agree with the scenarios.");
      return failed ? fail(lines.join("\n")) : ok(lines.join("\n"));
    },
  );

  server.tool(
    "show",
    "Tell the canvases open on a system what to show: which member to open and which element to focus, with an optional sentence beside it. `member` is a member's path (relative to the system file, or absolute) and must be listed; `focus` is <kind>:<name>, kind one of entity, attribute, machine, object, event, state, participant, message (e.g. 'message:9', 'entity:WaveCount', 'state:Published_Tradable'). No member: the system map. The system is the argument, else the active document when it is a .sysdf.json, else the system that lists the active document (in its folder or a parent folder), else the last system this server created, set or checked. A view changes no document.",
    { member: z.string().optional(), focus: z.string().optional(), note: z.string().optional(), system: z.string().optional() },
    async ({ member, focus, note, system }) => {
      const path = systemPathOf(host, system);
      if (typeof path !== "string") return fail(path.error);
      const def = readSystem(path);
      if (!def) return fail(existsSync(path) ? `${path} is not a readable system definition.` : `No system at ${path}.`);
      let stored: string | undefined;
      if (member) {
        const want = resolveMemberPath(path, member.trim());
        stored = def.members.find((m) => resolveMemberPath(path, m.path) === want)?.path;
        if (!stored) {
          return fail(`'${member}' is not a member of '${def.settings?.name ?? ""}'. Members: ${def.members.map((m) => m.path).join(", ") || "none"}.`);
        }
      }
      if (focus && !parseFocus(focus)) {
        return fail(
          `focus is <kind>:<name>, kind one of entity, attribute, machine, object, event, state, participant, message (got '${focus}').`,
        );
      }
      host.rememberSystem(path);
      const sent = await host.live.view({ docId: path, member: stored, focus, note });
      const what = `${stored ?? "the system map"}${focus ? `, focused on ${focus}` : ""}`;
      return sent.ok
        ? ok(`Asked the canvases on '${def.settings?.name ?? ""}' to show ${what}: ${sent.text}.`)
        : fail(`Could not ask the canvases on '${def.settings?.name ?? ""}' to show ${what}: ${sent.text}.`);
    },
  );
}
