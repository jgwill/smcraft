/**
 * Pure edits to a sequence definition (Spec 81) — the one vocabulary the MCP
 * tools and the canvas both speak, as `erd/edit.ts` is for ERDs.
 *
 * Every function returns a new definition and leaves its input untouched. An
 * edit that cannot be made throws an `Error` whose message says what to do
 * instead. Message positions are 0-based here; tools and people count from 1.
 *
 * Pure — no I/O.
 */
import {
  SQD_FRAGMENT_KINDS,
  allMessages,
  type SequenceDefinition,
  type SqdFragment,
  type SqdFragmentKind,
  type SqdMessage,
  type SqdParticipant,
  type SqdSettings,
} from "./definition.js";

const clone = (def: SequenceDefinition): SequenceDefinition => {
  const next: SequenceDefinition = {
    settings: { ...def.settings },
    participants: (def.participants ?? []).map((p) => ({ ...p, ...(p.holds ? { holds: [...p.holds] } : {}) })),
    messages: (def.messages ?? []).map((m) => ({ ...m })),
  };
  if (def.fragments) next.fragments = def.fragments.map((f) => ({ ...f, messages: (f.messages ?? []).map((m) => ({ ...m })) }));
  return next;
};

/** Drop the keys whose value is `undefined` or an empty string, so they never reach the JSON. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as T;
}

function participantIn(def: SequenceDefinition, name: string): SqdParticipant {
  const p = def.participants.find((x) => x.name === name);
  if (!p) {
    const known = def.participants.map((x) => x.name).join(", ") || "none";
    throw new Error(`Participant '${name}' not found. Participants: ${known}.`);
  }
  return p;
}

function requireParticipants(def: SequenceDefinition, m: SqdMessage): void {
  participantIn(def, m.from);
  participantIn(def, m.to);
  if (!m.label?.trim()) throw new Error("A message needs a label: what is said or done, in a few words.");
}

function fragmentIn(def: SequenceDefinition, fragment: number): SqdFragment {
  const f = def.fragments?.[fragment];
  if (f && !Array.isArray(f.messages)) f.messages = [];
  if (!f) throw new Error(`Fragment ${fragment + 1} not found. The sequence has ${def.fragments?.length ?? 0} fragment(s).`);
  return f;
}

export function updateSqdSettings(def: SequenceDefinition, patch: Partial<SqdSettings>): SequenceDefinition {
  const next = clone(def);
  next.settings = compact({ ...next.settings, ...patch }) as SqdSettings;
  return next;
}

export function addParticipant(def: SequenceDefinition, participant: SqdParticipant, at?: number): SequenceDefinition {
  if (!participant.name?.trim()) throw new Error("A participant needs a name.");
  const next = clone(def);
  if (next.participants.some((p) => p.name === participant.name)) {
    throw new Error(`Participant '${participant.name}' already exists.`);
  }
  const index = at === undefined ? next.participants.length : Math.max(0, Math.min(at, next.participants.length));
  next.participants.splice(index, 0, compact({ ...participant }));
  return next;
}

/** Change what a participant is. `undefined` leaves a field alone; `""` or `[]` clears it. */
export function updateParticipant(
  def: SequenceDefinition,
  name: string,
  patch: Partial<Omit<SqdParticipant, "name">>,
): SequenceDefinition {
  const next = clone(def);
  const p = participantIn(next, name);
  const merged = compact({ ...p, ...patch }) as SqdParticipant;
  next.participants[next.participants.indexOf(p)] = merged;
  return next;
}

/** Rename a participant, and every message that names it. */
export function renameParticipant(def: SequenceDefinition, name: string, to: string): SequenceDefinition {
  if (!to?.trim()) throw new Error("A participant needs a name.");
  const next = clone(def);
  const p = participantIn(next, name);
  if (to === name) return next;
  if (next.participants.some((x) => x.name === to)) throw new Error(`Participant '${to}' already exists.`);
  p.name = to;
  const rename = (m: SqdMessage) => {
    if (m.from === name) m.from = to;
    if (m.to === name) m.to = to;
  };
  next.messages.forEach(rename);
  for (const f of next.fragments ?? []) f.messages.forEach(rename);
  return next;
}

/** Move a participant to another column (0-based). Messages are untouched. */
export function moveParticipant(def: SequenceDefinition, name: string, to: number): SequenceDefinition {
  const next = clone(def);
  const p = participantIn(next, name);
  next.participants.splice(next.participants.indexOf(p), 1);
  next.participants.splice(Math.max(0, Math.min(to, next.participants.length)), 0, p);
  return next;
}

/** Remove a participant and every message it sends or receives, as removing an entity takes its relationships. */
export function removeParticipant(def: SequenceDefinition, name: string): SequenceDefinition {
  const next = clone(def);
  participantIn(next, name);
  next.participants = next.participants.filter((p) => p.name !== name);
  const keeps = (m: SqdMessage) => m.from !== name && m.to !== name;
  const removedBefore = (n: number) => def.messages.slice(0, n).filter((m) => !keeps(m)).length;
  next.messages = next.messages.filter(keeps);
  if (next.fragments) {
    next.fragments = next.fragments
      .map((f) => ({ ...f, after: Math.max(0, f.after - removedBefore(f.after)), messages: f.messages.filter(keeps) }))
      .filter((f) => f.messages.length > 0);
    if (!next.fragments.length) delete next.fragments;
  }
  return next;
}

/** Insert a main message; `at` is its 0-based position, the end when omitted. Fragments keep their branch point. */
export function addMessage(def: SequenceDefinition, message: SqdMessage, at?: number): SequenceDefinition {
  const next = clone(def);
  requireParticipants(next, message);
  const index = at === undefined ? next.messages.length : Math.max(0, Math.min(at, next.messages.length));
  next.messages.splice(index, 0, compact({ ...message }));
  if (next.fragments) for (const f of next.fragments) if (f.after > index) f.after += 1;
  return next;
}

export function updateMessage(
  def: SequenceDefinition,
  index: number,
  patch: Partial<SqdMessage>,
  fragment: number | null = null,
): SequenceDefinition {
  const next = clone(def);
  const list = fragment === null ? next.messages : fragmentIn(next, fragment).messages;
  const current = list[index];
  if (!current) throw new Error(`Message ${index + 1} not found${fragment === null ? "" : ` in fragment ${fragment + 1}`}.`);
  const merged = compact({ ...current, ...patch }) as SqdMessage;
  requireParticipants(next, merged);
  list[index] = merged;
  return next;
}

/** Remove a main message; a fragment branching after it moves to the message before. */
export function removeMessage(def: SequenceDefinition, index: number, fragment: number | null = null): SequenceDefinition {
  const next = clone(def);
  if (fragment !== null) {
    const f = fragmentIn(next, fragment);
    if (!f.messages[index]) throw new Error(`Message ${index + 1} not found in fragment ${fragment + 1}.`);
    f.messages.splice(index, 1);
    return next;
  }
  if (!next.messages[index]) throw new Error(`Message ${index + 1} not found. The sequence has ${next.messages.length}.`);
  next.messages.splice(index, 1);
  if (next.fragments) for (const f of next.fragments) if (f.after > index) f.after -= 1;
  return next;
}

/** Move a main message from one position to another (both 0-based). Fragments keep the message they branch after. */
export function moveMessage(def: SequenceDefinition, from: number, to: number): SequenceDefinition {
  const next = clone(def);
  if (!next.messages[from]) throw new Error(`Message ${from + 1} not found.`);
  const target = Math.max(0, Math.min(to, next.messages.length - 1));
  const anchors = (next.fragments ?? []).map((f) => (f.after > 0 ? next.messages[f.after - 1] : null));
  const [m] = next.messages.splice(from, 1);
  next.messages.splice(target, 0, m);
  (next.fragments ?? []).forEach((f, i) => {
    const anchor = anchors[i];
    if (anchor) f.after = next.messages.indexOf(anchor) + 1;
  });
  return next;
}

export function addFragment(
  def: SequenceDefinition,
  fragment: { kind: SqdFragmentKind; label: string; after: number; notes?: string; messages?: SqdMessage[] },
): SequenceDefinition {
  if (!SQD_FRAGMENT_KINDS.includes(fragment.kind)) {
    throw new Error(`A fragment is one of ${SQD_FRAGMENT_KINDS.join(", ")}; got '${fragment.kind}'.`);
  }
  if (!fragment.label?.trim()) throw new Error("A fragment needs a label: the condition in words.");
  const next = clone(def);
  if (!Number.isInteger(fragment.after) || fragment.after < 0 || fragment.after > next.messages.length) {
    throw new Error(`A fragment branches after a main message, 0 to ${next.messages.length}; got ${fragment.after}.`);
  }
  for (const m of fragment.messages ?? []) requireParticipants(next, m);
  // `compact` would drop an empty `messages` array; a fragment always carries one.
  (next.fragments ??= []).push({
    ...compact({ ...fragment, messages: undefined }),
    messages: (fragment.messages ?? []).map((m) => compact({ ...m })),
  } as SqdFragment);
  return next;
}

export function updateFragment(
  def: SequenceDefinition,
  fragment: number,
  patch: Partial<Omit<SqdFragment, "messages">>,
): SequenceDefinition {
  const next = clone(def);
  const f = fragmentIn(next, fragment);
  if (patch.kind !== undefined && !SQD_FRAGMENT_KINDS.includes(patch.kind)) {
    throw new Error(`A fragment is one of ${SQD_FRAGMENT_KINDS.join(", ")}; got '${patch.kind}'.`);
  }
  if (patch.after !== undefined && (!Number.isInteger(patch.after) || patch.after < 0 || patch.after > next.messages.length)) {
    throw new Error(`A fragment branches after a main message, 0 to ${next.messages.length}; got ${patch.after}.`);
  }
  next.fragments![fragment] = { ...compact({ ...f, ...patch, messages: undefined }), messages: f.messages ?? [] } as SqdFragment;
  return next;
}

export function removeFragment(def: SequenceDefinition, fragment: number): SequenceDefinition {
  const next = clone(def);
  fragmentIn(next, fragment);
  next.fragments!.splice(fragment, 1);
  if (!next.fragments!.length) delete next.fragments;
  return next;
}

/** Append (or insert at `at`) a message inside a fragment. */
export function addFragmentMessage(
  def: SequenceDefinition,
  fragment: number,
  message: SqdMessage,
  at?: number,
): SequenceDefinition {
  const next = clone(def);
  const f = fragmentIn(next, fragment);
  requireParticipants(next, message);
  const index = at === undefined ? f.messages.length : Math.max(0, Math.min(at, f.messages.length));
  f.messages.splice(index, 0, compact({ ...message }));
  return next;
}

/** One line per participant and per message — what a tool shows after an edit. */
export function summarizeSequence(def: SequenceDefinition): string {
  const lines: string[] = [];
  const kindOf = (p: SqdParticipant) =>
    p.actor ? `actor ${p.actor}` : p.object ? `object ${p.object}` : p.service ? `service ${p.service}` : "participant";
  for (const p of def.participants ?? []) {
    lines.push(`${p.name} — ${kindOf(p)}${p.holds?.length ? `, holds ${p.holds.join(", ")}` : ""}`);
  }
  for (const { ref, message: m } of allMessages(def)) {
    const extra = [
      m.event && `fires ${m.event}`,
      m.carries && `carries ${m.carries}`,
      m.state && `then ${m.state}`,
      m.optional && "optional",
    ].filter(Boolean);
    lines.push(`${ref}. ${m.from} → ${m.to}: ${m.label}${extra.length ? ` (${extra.join(", ")})` : ""}`);
  }
  for (const [i, f] of (def.fragments ?? []).entries()) {
    lines.push(`fragment ${i + 1}: ${f.kind} after ${f.after} — ${f.label} (${(f.messages ?? []).length} message(s))`);
  }
  return lines.join("\n");
}
