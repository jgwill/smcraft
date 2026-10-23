/**
 * SQDF — the Sequence Definition Format (Spec 81).
 *
 * The third document of the loom, beside SMDF (behaviour) and ERDF (data): a
 * usage scenario, told as who sends what to whom, in order. It links to its
 * siblings by name only, as ERDF does: a participant may BE one of a machine's
 * objects or HOLD entities, a message may FIRE an event of a machine and CARRY
 * an entity, and a message may say which STATE the machine is in after it.
 * Those names are what `checkSystem` resolves and what `replayScenario` walks.
 *
 * Main messages are numbered from 1 in the order they are written. A fragment
 * (`alt`, `opt`, `loop`) holds its own messages and says after which main
 * message it branches, so where an alternative begins is never left to the
 * drawing.
 */

export interface SqdSettings {
  namespace: string;
  name: string;
  description?: string;
  /** Working notes about the whole scenario, for whoever opens it next — a person or an agent. */
  notes?: string;
}

export interface SqdParticipant {
  name: string;
  description?: string;
  notes?: string;
  /** An actor of the system this scenario belongs to (`actors[].name` in the `.sysdf.json`): a person or an agent. */
  actor?: string;
  /** A running service or component, as free text (`jgt-charting`, `:8085`). */
  service?: string;
  /** `settings.objects[].instance` of a member machine: this participant IS that object. */
  object?: string;
  /** Entities this participant keeps (ERDF `entities[].name`). */
  holds?: string[];
}

export interface SqdMessage {
  from: string;
  to: string;
  label: string;
  description?: string;
  notes?: string;
  /** An event id of a member machine. Firing it is what this message does to the behaviour. */
  event?: string;
  /** `settings.name` of the machine the event is for, when several define it. Also where `state` is read. */
  machine?: string;
  /** An entity this message carries (ERDF `entities[].name`). */
  carries?: string;
  /**
   * The state the machine is in once this message is handled — a state
   * invariant. The replay checks it, and reconcile can add the transition it
   * implies when the machine refuses the event.
   */
  state?: string;
  /** The scenario holds with or without this message. */
  optional?: boolean;
  /** A reply to an earlier message (drawn dashed). */
  reply?: boolean;
}

export type SqdFragmentKind = "alt" | "opt" | "loop";

export const SQD_FRAGMENT_KINDS: readonly SqdFragmentKind[] = ["alt", "opt", "loop"];

/**
 * A part of the scenario that happens only sometimes.
 *
 * - `alt`: instead of the main messages after `after`, these happen.
 * - `opt`: these may happen after `after`, and the main messages continue.
 * - `loop`: these repeat after `after`, and the main messages continue.
 */
export interface SqdFragment {
  kind: SqdFragmentKind;
  /** The condition, in words (`the market settles the count first`). */
  label: string;
  /** Number of the main message it branches after; 0 branches before the first. */
  after: number;
  messages: SqdMessage[];
  notes?: string;
}

export interface SequenceDefinition {
  settings: SqdSettings;
  participants: SqdParticipant[];
  messages: SqdMessage[];
  fragments?: SqdFragment[];
}

/** The canonical extension; tools pick the document type from it. */
export const SQDF_EXTENSION = ".sqdf.json";

export function isSqdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(SQDF_EXTENSION);
}

/**
 * Tell a sequence document from its siblings when only content is at hand: it
 * carries `participants` and `messages`, and never `entities` or a `state` tree.
 */
export function isSequenceDefinition(doc: unknown): doc is SequenceDefinition {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return Array.isArray(d.participants) && Array.isArray(d.messages) && !("state" in d) && !("entities" in d);
}

export function emptySequence(namespace: string, name: string, description?: string): SequenceDefinition {
  return {
    settings: description ? { namespace, name, description } : { namespace, name },
    participants: [],
    messages: [],
  };
}

/**
 * The address of one message: `"9"` for main message 9, `"f1.2"` for the second
 * message of the first fragment. Used in reports, the canvas, and `focus`.
 */
export function messageRef(fragment: number | null, index: number): string {
  return fragment === null ? String(index + 1) : `f${fragment + 1}.${index + 1}`;
}

/** Parse a message address back to its position. Null when it does not name a message of `def`. */
export function parseMessageRef(
  def: SequenceDefinition,
  ref: string,
): { fragment: number | null; index: number; message: SqdMessage } | null {
  const main = /^\d+$/.exec(ref);
  if (main) {
    const index = Number(ref) - 1;
    const message = def.messages?.[index];
    return message ? { fragment: null, index, message } : null;
  }
  const frag = /^f(\d+)\.(\d+)$/.exec(ref);
  if (!frag) return null;
  const fragment = Number(frag[1]) - 1;
  const index = Number(frag[2]) - 1;
  const message = def.fragments?.[fragment]?.messages?.[index];
  return message ? { fragment, index, message } : null;
}

/** Every message with its address, main messages first, then each fragment's. */
export function allMessages(def: SequenceDefinition): { ref: string; message: SqdMessage; fragment: number | null }[] {
  const out: { ref: string; message: SqdMessage; fragment: number | null }[] = [];
  (def.messages ?? []).forEach((message, i) => out.push({ ref: messageRef(null, i), message, fragment: null }));
  (def.fragments ?? []).forEach((f, fi) =>
    (f?.messages ?? []).forEach((message, i) => out.push({ ref: messageRef(fi, i), message, fragment: fi })),
  );
  return out;
}
