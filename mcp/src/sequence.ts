/**
 * The sequence half of the MCP server (Spec 81).
 *
 * A sequence (`.sqdf.json`) is a usage scenario: who sends what to whom, in
 * order. The tools here act on the active document when it is an SQDF;
 * `create_sequence` is the one that also moves the active document.
 *
 * People and tools count from 1: a main message is addressed by its number
 * (`"9"`), a fragment's message as `f<fragment>.<n>` (`"f1.2"`), a fragment by
 * its number. The protocol's edits count from 0; the conversion happens here.
 *
 * A sequence travels to the live canvas as a whole document (`emitFull`), as an
 * ERD does. After each edit that changes the scenario, `afterEdit` gives the
 * system a chance to reconcile (Spec 82 reconcile mode), and its one line is
 * appended to the tool result.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  SQD_FRAGMENT_KINDS,
  addFragment,
  addFragmentMessage,
  addMessage,
  addParticipant,
  allMessages,
  docKindOfPath,
  emptySequence,
  isSequenceDefinition,
  isSqdfPath,
  moveMessage,
  moveParticipant,
  parseMessageRef,
  removeFragment,
  removeMessage,
  removeParticipant,
  renameParticipant,
  renderMermaidSequence,
  summarizeSequence,
  updateFragment,
  updateMessage,
  updateParticipant,
  updateSqdSettings,
  validateSequence,
  type SequenceDefinition,
  type SqdFragmentKind,
  type SqdMessage,
  normalizeNotes
} from "@miadi/stateloom-protocol";
import { stampedOutputPath } from "@miadi/stateloom-cli/render";
import { formatNotes } from "./erd.js";
import { writeFileAtomic } from "./atomicWrite.js";

export interface SequenceHost {
  /** The active document's absolute path. */
  projectFile(): string;
  /** Re-point the active document under set_project_file's guards. Returns the refusal, if any. */
  switchTo(path: string): string | undefined;
  /** Mirror the whole document to the live bridge room. Best-effort. */
  emitFull(def: SequenceDefinition): void;
  /** The refusal for a path outside the permitted document root, if any. */
  outsideRoot(path: string): string | undefined;
  /** After an edit that changed the scenario was written: one line to append (reconcile mode), or nothing. */
  afterEdit?(path: string): Promise<string | undefined>;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const KIND_WORDS = { machine: "a state machine", erd: "an ERD", sequence: "a sequence", system: "a system" } as const;

export function readSequence(path: string): SequenceDefinition | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = normalizeNotes(JSON.parse(readFileSync(path, "utf8")));
    return isSequenceDefinition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSequence(path: string, def: SequenceDefinition): void {
  writeFileAtomic(path, JSON.stringify(def, null, 2) + "\n");
}

/** One line for set_project_file / get_project_file when the active document is an SQDF. */
export function sequenceSummary(path: string): string {
  const def = readSequence(path);
  if (def) {
    return `existing sequence '${def.settings?.name ?? ""}' (${def.participants.length} participants, ${def.messages.length} messages, ${(def.fragments ?? []).length} fragments)`;
  }
  return existsSync(path)
    ? "file exists but is not a readable sequence definition"
    : "no file yet — create_sequence or load_definition will write it";
}

const NOT_SEQUENCE = (path: string): string =>
  `The active document ${path} is ${KIND_WORDS[docKindOfPath(path)]}, not a sequence. Use create_sequence, or set_project_file to a .sqdf.json document.`;

/** A 1-based message address → the protocol's position. Throws an Error that says how to address one. */
function position(def: SequenceDefinition, ref: string): { fragment: number | null; index: number } {
  const hit = parseMessageRef(def, String(ref).trim());
  if (!hit) {
    const count = def.messages.length;
    throw new Error(
      `Message '${ref}' not found. A main message is its number (1 to ${count}); a fragment's message is f<fragment>.<n>, e.g. 'f1.2'.`,
    );
  }
  return { fragment: hit.fragment, index: hit.index };
}

const describe = (m: SqdMessage): string => {
  const extra = [
    m.event && `fires ${m.event}`,
    m.machine && `for ${m.machine}`,
    m.carries && `carries ${m.carries}`,
    m.state && `then ${m.state}`,
    m.optional && "optional",
    m.reply && "reply",
  ].filter(Boolean);
  return `${m.from} → ${m.to}: ${m.label}${extra.length ? ` (${extra.join(", ")})` : ""}`;
};

/** Read the active SQDF, apply `edit`, persist, mirror, reconcile, and report. Errors become tool errors. */
async function mutate(
  host: SequenceHost,
  edit: (def: SequenceDefinition) => SequenceDefinition,
  report: (def: SequenceDefinition, before: SequenceDefinition) => string,
  opts: { reconcile?: boolean } = {},
): Promise<ToolResult> {
  const path = host.projectFile();
  if (!isSqdfPath(path)) return fail(NOT_SEQUENCE(path));
  const def = readSequence(path);
  if (!def) return fail(`No sequence at ${path}. Use create_sequence first.`);
  let next: SequenceDefinition;
  try {
    next = edit(def);
  } catch (e) {
    return fail(message(e));
  }
  writeSequence(path, next);
  host.emitFull(next);
  let tail: string | undefined;
  if (opts.reconcile !== false && host.afterEdit) {
    tail = await host.afterEdit(path).catch((e) => `reconcile could not run: ${message(e)}`);
  }
  return ok(report(next, def) + (tail ? `\n${tail}` : ""));
}

// ─── The tools that answer by extension (called from server.ts) ──────

export function sequenceGetDefinition(host: SequenceHost): ToolResult {
  const def = readSequence(host.projectFile());
  return def ? ok(JSON.stringify(def, null, 2)) : fail(`No sequence at ${host.projectFile()}.`);
}

export async function sequenceLoadDefinition(host: SequenceHost, json: string): Promise<ToolResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return fail(`Invalid JSON: ${e}`);
  }
  if (!isSequenceDefinition(parsed)) {
    return fail(
      `The active document ${host.projectFile()} is a sequence, and this JSON is not one (it needs "participants" and "messages" arrays, and no "state" or "entities"). ` +
        `To load another kind of document, set_project_file to a document of that kind first.`,
    );
  }
  const path = host.projectFile();
  writeSequence(path, parsed);
  host.emitFull(parsed);
  const errors = validateSequence(parsed);
  const tail = host.afterEdit ? await host.afterEdit(path).catch((e) => `reconcile could not run: ${message(e)}`) : undefined;
  return ok(
    `Loaded sequence → ${path}: ${parsed.settings?.name ?? ""} (${parsed.participants.length} participants, ${parsed.messages.length} messages)` +
      (errors.length ? `\n${errors.map((e) => `[${e.ruleId}] ${e.message}`).join("\n")}` : "") +
      (tail ? `\n${tail}` : ""),
  );
}

export function sequenceRender(
  host: SequenceHost,
  opts: { format?: string; path?: string; stamp?: boolean },
): ToolResult {
  const doc = host.projectFile();
  const def = readSequence(doc);
  if (!def) return fail(`No sequence at ${doc}.`);
  const format = opts.format ?? "mermaid";
  if (format !== "mermaid") {
    return fail(`A sequence renders as mermaid only (asked for ${format}); svg and png are not drawn for a sequence yet.`);
  }
  if (opts.path) {
    const denial = host.outsideRoot(opts.path);
    if (denial) return fail(denial);
  }
  // `.seq.mmd`, so a machine, an ERD and a sequence that share a basename never overwrite each other.
  const out = opts.path
    ? resolve(opts.path)
    : opts.stamp
      ? stampedOutputPath(doc, def.settings?.name, "mermaid", new Date())
      : resolve(doc).replace(/\.sqdf\.json$/i, "") + ".seq.mmd";
  const text = renderMermaidSequence(def);
  writeFileSync(out, text + "\n", "utf8");
  return {
    content: [
      { type: "text", text: `Rendered sequence '${def.settings?.name ?? ""}' → ${out} (${text.length} bytes)` },
      { type: "text", text },
    ],
  };
}

function sequenceNotes(def: SequenceDefinition): { target: string | null; notes: string }[] {
  const out: { target: string | null; notes: string }[] = [];
  if (def.settings?.notes?.trim()) out.push({ target: null, notes: def.settings.notes });
  for (const p of def.participants ?? []) if (p?.notes?.trim()) out.push({ target: p.name, notes: p.notes });
  for (const { ref, message: m } of allMessages(def)) if (m?.notes?.trim()) out.push({ target: `message ${ref}`, notes: m.notes });
  (def.fragments ?? []).forEach((f, i) => {
    if (f?.notes?.trim()) out.push({ target: `fragment ${i + 1}`, notes: f.notes });
  });
  return out;
}

export function sequenceGetNotes(host: SequenceHost): ToolResult {
  const def = readSequence(host.projectFile());
  if (!def) return fail(`No sequence at ${host.projectFile()}.`);
  return ok(formatNotes(def.settings?.name ?? "", host.projectFile(), sequenceNotes(def)));
}

/**
 * `target` is a participant's name, a message address (`9`, `f1.2`, or `message 9`
 * as get_notes prints it), or `fragment N`. Omitted: the whole sequence.
 */
export function sequenceSetNotes(host: SequenceHost, target: string | undefined, notes: string): Promise<ToolResult> {
  let what = "the sequence";
  return mutate(
    host,
    (def) => {
      if (!target) return updateSqdSettings(def, { notes });
      if (def.participants.some((p) => p.name === target)) {
        what = `participant '${target}'`;
        return updateParticipant(def, target, { notes });
      }
      const frag = /^fragment\s*:?\s*(\d+)$/i.exec(target.trim());
      if (frag) {
        what = `fragment ${frag[1]}`;
        return updateFragment(def, Number(frag[1]) - 1, { notes });
      }
      const ref = target.trim().replace(/^message\s*:?\s*/i, "");
      if (parseMessageRef(def, ref)) {
        const { fragment, index } = position(def, ref);
        what = `message ${ref}`;
        return updateMessage(def, index, { notes }, fragment);
      }
      throw new Error(
        `'${target}' is not a participant, a message (9, f1.2) or a fragment (fragment 1) of '${def.settings?.name ?? ""}'.`,
      );
    },
    () => `${notes.trim() ? "Saved" : "Cleared"} the notes on ${what}.`,
    { reconcile: false },
  );
}

// ─── Tool registration ───────────────────────────────────────────────

const messageFields = {
  from: z.string().describe("The participant that sends it"),
  to: z.string().describe("The participant that receives it"),
  label: z.string().describe("What is said or done, in a few words"),
  event: z.string().optional().describe("An event of a member machine that this message fires"),
  machine: z.string().optional().describe("settings.name of the machine the event is for, when several define it"),
  carries: z.string().optional().describe("An ERD entity this message carries"),
  state: z.string().optional().describe("The state the machine is in once this message is handled"),
  optional: z.boolean().optional().describe("The scenario holds with or without this message"),
  reply: z.boolean().optional().describe("A reply to an earlier message (drawn dashed)"),
  description: z.string().optional(),
};

/** Drop `false` booleans, so `optional: false` removes the key instead of writing it. */
function messageOf(fields: Partial<SqdMessage>): SqdMessage {
  const m = { ...fields } as SqdMessage;
  if (m.optional === false) delete m.optional;
  if (m.reply === false) delete m.reply;
  return m;
}

export function registerSequenceTools(server: McpServer, host: SequenceHost): void {
  server.tool(
    "create_sequence",
    "Create a new sequence definition (.sqdf.json) and make it the active document. A sequence is a usage scenario: who sends what to whom, in order. Its messages can fire events of the system's machines, carry its entities, and say which state a machine is then in, so a scenario can be replayed through the machines (replay_scenario) and can upgrade them (reconcile_scenario). Without `path` it lands next to the active document as <name>.sqdf.json. Refuses to replace a sequence that already has messages unless overwrite is true.",
    {
      namespace: z.string(),
      name: z.string(),
      description: z.string().optional(),
      path: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
    async ({ namespace, name, description, path, overwrite }) => {
      const active = host.projectFile();
      const target = resolve(path ?? (isSqdfPath(active) ? active : join(dirname(active), `${name}.sqdf.json`)));
      if (!isSqdfPath(target)) return fail(`A sequence document ends in .sqdf.json (got '${target}').`);
      const existing = readSequence(target);
      if (existing && existing.messages.length > 0 && !overwrite) {
        return fail(
          `${target} already holds sequence '${existing.settings?.name ?? ""}' with ${existing.messages.length} messages. ` +
            `Pass overwrite: true to replace it, or set_project_file to it to keep working on it.`,
        );
      }
      if (target !== active) {
        const denial = host.switchTo(target);
        if (denial) return fail(denial);
      } else {
        const denial = host.outsideRoot(target);
        if (denial) return fail(denial);
      }
      const def = emptySequence(namespace, name, description);
      writeSequence(target, def);
      host.emitFull(def);
      return ok(
        `Created sequence '${name}' in namespace '${namespace}' → ${target}. It is now the active document. Add participants, then messages.`,
      );
    },
  );

  server.tool(
    "add_participant",
    "Add a participant to the active sequence. Say what it is with at most one of: `actor` (an actor of the system — a person or an agent), `service` (a running service, as free text), `object` (a machine's object instance, settings.objects[].instance). `holds` lists the ERD entities it keeps. `at` is its 1-based position from the left; the end when omitted.",
    {
      name: z.string(),
      actor: z.string().optional(),
      service: z.string().optional(),
      object: z.string().optional(),
      holds: z.array(z.string()).optional(),
      description: z.string().optional(),
      at: z.number().int().min(1).optional(),
    },
    async ({ at, ...participant }) =>
      mutate(
        host,
        (def) => addParticipant(def, participant, at === undefined ? undefined : at - 1),
        (def) => `Added participant '${participant.name}' (${def.participants.findIndex((p) => p.name === participant.name) + 1} of ${def.participants.length}).`,
      ),
  );

  server.tool(
    "update_participant",
    "Change what a participant of the active sequence is. Omit a field to leave it alone; an empty string (or an empty holds list) clears it. The name is how messages address it and does not change here.",
    {
      name: z.string(),
      actor: z.string().optional(),
      service: z.string().optional(),
      object: z.string().optional(),
      holds: z.array(z.string()).optional(),
      description: z.string().optional(),
    },
    async ({ name, ...patch }) =>
      mutate(host, (def) => updateParticipant(def, name, patch), () => `Updated participant '${name}'.`),
  );

  server.tool(
    "remove_participant",
    "Remove a participant from the active sequence, with every message it sends or receives (a fragment left empty goes too).",
    { name: z.string() },
    async ({ name }) =>
      mutate(
        host,
        (def) => removeParticipant(def, name),
        (def, before) =>
          `Removed participant '${name}' and ${allMessages(before).length - allMessages(def).length} message(s) of theirs.`,
      ),
  );

  server.tool(
    "rename_participant",
    "Rename a participant of the active sequence. Every message and fragment message it sends or receives follows the new name.",
    { name: z.string(), to: z.string() },
    async ({ name, to }) =>
      mutate(
        host,
        (def) => renameParticipant(def, name, to),
        (def, before) => {
          const n = allMessages(before).filter(({ message: m }) => m.from === name || m.to === name).length;
          return name === to ? `Participant '${name}' already has that name.` : `Renamed participant '${name}' to '${to}' in ${n} message(s).`;
        },
      ),
  );

  server.tool(
    "move_participant",
    "Move a participant of the active sequence to another column, counted from 1 on the left. Messages are untouched.",
    { name: z.string(), to: z.number().int().min(1) },
    async ({ name, to }) =>
      mutate(
        host,
        (def) => moveParticipant(def, name, to - 1),
        (def) => `Moved participant '${name}' to column ${def.participants.findIndex((p) => p.name === name) + 1} of ${def.participants.length}.`,
      ),
  );

  server.tool(
    "add_message",
    "Add a main message to the active sequence. `event` fires an event of a member machine (`machine` says which, when several define it); `state` says which state the machine is in once the message is handled — a scenario ahead of its machines is how new behaviour is designed, and reconcile_scenario (or reconcile mode auto) adds what it implies. `at` is the 1-based number the message will have; the end when omitted. Fragments keep the message they branch after.",
    { ...messageFields, at: z.number().int().min(1).optional() },
    async ({ at, ...fields }) => {
      const m = messageOf(fields);
      return mutate(
        host,
        (def) => addMessage(def, m, at === undefined ? undefined : at - 1),
        (def) => {
          const n = at === undefined ? def.messages.length : Math.min(at, def.messages.length);
          return `Added message ${n}: ${describe(def.messages[n - 1])}.`;
        },
      );
    },
  );

  server.tool(
    "update_message",
    "Change a message of the active sequence, addressed by `ref`: its number ('9') or, inside a fragment, f<fragment>.<n> ('f1.2'). Omit a field to leave it alone; an empty string clears it, and optional:false or reply:false removes the flag.",
    {
      ref: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
      label: z.string().optional(),
      event: z.string().optional(),
      machine: z.string().optional(),
      carries: z.string().optional(),
      state: z.string().optional(),
      optional: z.boolean().optional(),
      reply: z.boolean().optional(),
      description: z.string().optional(),
    },
    async ({ ref, ...fields }) => {
      // A field the caller omitted is absent from `fields`; `""` or an `undefined` flag clears it.
      const patch: Partial<SqdMessage> = { ...fields };
      if (patch.optional === false) patch.optional = undefined;
      if (patch.reply === false) patch.reply = undefined;
      return mutate(
        host,
        (def) => {
          const { fragment, index } = position(def, ref);
          return updateMessage(def, index, patch, fragment);
        },
        (def) => `Updated message ${ref}: ${describe(parseMessageRef(def, ref)!.message)}.`,
      );
    },
  );

  server.tool(
    "remove_message",
    "Remove a message of the active sequence, addressed by its number ('9') or f<fragment>.<n> ('f1.2'). The main messages after it move up by one; a fragment branching after it moves to the message before.",
    { ref: z.string() },
    async ({ ref }) => {
      let removed = "";
      return mutate(
        host,
        (def) => {
          const { fragment, index } = position(def, ref);
          removed = describe(parseMessageRef(def, ref)!.message);
          return removeMessage(def, index, fragment);
        },
        () => `Removed message ${ref}: ${removed}.`,
      );
    },
  );

  server.tool(
    "move_message",
    "Move a main message of the active sequence to another number (both counted from 1). Fragments keep the message they branch after.",
    { ref: z.string(), to: z.number().int().min(1) },
    async ({ ref, to }) =>
      mutate(
        host,
        (def) => {
          const { fragment, index } = position(def, ref);
          if (fragment !== null) throw new Error(`Only main messages move; ${ref} is inside fragment ${fragment + 1}.`);
          return moveMessage(def, index, to - 1);
        },
        (def) => {
          const n = Math.min(to, def.messages.length);
          return `Moved message ${ref} to ${n}: ${describe(def.messages[n - 1])}.`;
        },
      ),
  );

  server.tool(
    "add_fragment",
    `Add a fragment — a part of the scenario that happens only sometimes — to the active sequence. kind is one of ${SQD_FRAGMENT_KINDS.join(", ")}: alt replaces the main messages after \`after\`; opt may happen there and the main messages continue; loop repeats there. \`after\` is the number of the main message it branches after (0: before the first). \`label\` is the condition in words. Messages can be given here or added with add_fragment_message.`,
    {
      kind: z.enum(SQD_FRAGMENT_KINDS as [SqdFragmentKind, ...SqdFragmentKind[]]),
      label: z.string(),
      after: z.number().int().min(0),
      messages: z.array(z.object(messageFields)).optional(),
    },
    async ({ kind, label, after, messages }) =>
      mutate(
        host,
        (def) => addFragment(def, { kind, label, after, messages: (messages ?? []).map(messageOf) }),
        (def) =>
          `Added fragment ${def.fragments!.length}: ${kind} after message ${after} — ${label} (${messages?.length ?? 0} message(s)).`,
      ),
  );

  server.tool(
    "add_fragment_message",
    "Add a message inside a fragment of the active sequence. `fragment` is the fragment's number (from 1); `at` is the 1-based position inside it, the end when omitted.",
    { fragment: z.number().int().min(1), ...messageFields, at: z.number().int().min(1).optional() },
    async ({ fragment, at, ...fields }) => {
      const m = messageOf(fields);
      return mutate(
        host,
        (def) => addFragmentMessage(def, fragment - 1, m, at === undefined ? undefined : at - 1),
        (def) => {
          const list = def.fragments![fragment - 1].messages;
          const n = at === undefined ? list.length : Math.min(at, list.length);
          return `Added message f${fragment}.${n}: ${describe(list[n - 1])}.`;
        },
      );
    },
  );

  server.tool(
    "remove_fragment",
    "Remove a fragment of the active sequence, with its messages. `fragment` is its number, from 1; the fragments after it move up by one.",
    { fragment: z.number().int().min(1) },
    async ({ fragment }) =>
      mutate(host, (def) => removeFragment(def, fragment - 1), () => `Removed fragment ${fragment}.`),
  );

  server.tool(
    "validate_sequence",
    "Validate the active sequence against rules S001–S006 (settings, participants, message ends and labels, fragments) and list what it holds. Whether the events, objects and entities it names exist is a question about the system: check_system answers it.",
    {},
    async () => {
      const path = host.projectFile();
      if (!isSqdfPath(path)) return fail(NOT_SEQUENCE(path));
      const def = readSequence(path);
      if (!def) return fail(`No sequence at ${path}. Use create_sequence first.`);
      const errors = validateSequence(def);
      const body = summarizeSequence(def) || "(empty)";
      return errors.length
        ? fail(
            `${errors.length} problem(s) in '${def.settings?.name ?? ""}':\n${errors.map((e) => `[${e.ruleId}] ${e.message}`).join("\n")}\n\n${body}`,
          )
        : ok(`Sequence '${def.settings?.name ?? ""}' is valid.\n${body}`);
    },
  );
}
