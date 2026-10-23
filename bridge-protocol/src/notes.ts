/**
 * Notes — what a person or an agent wrote down while discussing a diagram.
 *
 * Both document types carry them the same way: `settings.notes` for the whole
 * diagram, and `notes` on a shape (a state, an entity). They are saved in the
 * document so whoever opens it next, a future self or an agent, finds them.
 * They are not part of the model: engines and code generators ignore them.
 *
 * `collectNotes` gathers every note in a document into one list, so a reader
 * can be told "here is what was said about this diagram" in a single call.
 *
 * Pure — no I/O.
 */
import type { StateDef, StateMachineDefinition } from "./definition.js";
import { isErdDefinition, type EntityRelationshipDefinition } from "./erd/definition.js";

export interface NoteEntry {
  /** The shape the note is on; `null` for the diagram itself. */
  target: string | null;
  notes: string;
}

/**
 * A note as text, whatever shape a hand-written file gave it. The format says
 * a note is a string; files written by hand or by older tools also carry a
 * list of paragraphs (a session kept `settings.notes` as `["…", "…"]`), and
 * every reader that called `.trim()` on it failed. A list becomes paragraphs
 * separated by a blank line; anything else that is not a string becomes its
 * JSON; absence stays absence.
 */
export function noteText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n\n");
  return JSON.stringify(value);
}

const NOTE_HOLDERS = ["settings", "states", "parallel", "entities", "participants", "messages", "fragments", "members", "state"] as const;

/**
 * Every `notes` in a loom document turned into text (see `noteText`), at any
 * depth: settings, states and their regions, entities, participants, messages,
 * fragments and their messages, members. Pure: returns a new document when
 * something changed, the same one when nothing did. Every tool that loads a
 * document runs this first, so no reader meets a note that is not a string.
 */
export function normalizeNotes<T>(doc: T): T {
  let changed = false;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      let any = false;
      const next = node.map((n) => {
        const w = walk(n);
        if (w !== n) any = true;
        return w;
      });
      return any ? next : node;
    }
    if (!node || typeof node !== "object") return node;
    const obj = node as Record<string, unknown>;
    let copy: Record<string, unknown> | null = null;
    if ("notes" in obj && typeof obj.notes !== "string" && obj.notes !== undefined) {
      copy = { ...obj };
      const text = noteText(obj.notes);
      if (text === undefined || !text.trim()) delete copy.notes;
      else copy.notes = text;
      changed = true;
    }
    for (const key of NOTE_HOLDERS) {
      if (!(key in obj)) continue;
      const before = (copy ?? obj)[key];
      const after = walk(before);
      if (after !== before) {
        copy ??= { ...obj };
        copy[key] = after;
      }
    }
    return copy ?? obj;
  };
  const out = walk(doc) as T;
  return changed ? out : doc;
}

function stateNotes(state: StateDef, out: NoteEntry[]): void {
  const text = noteText(state.notes);
  if (text?.trim()) out.push({ target: state.name, notes: text });
  for (const child of state.states ?? []) stateNotes(child, out);
  for (const region of state.parallel?.states ?? []) stateNotes(region, out);
}

export function collectNotes(def: StateMachineDefinition | EntityRelationshipDefinition): NoteEntry[] {
  const out: NoteEntry[] = [];
  const own = noteText(def.settings?.notes);
  if (own?.trim()) out.push({ target: null, notes: own });
  if (isErdDefinition(def)) {
    for (const e of def.entities ?? []) {
      const text = noteText(e?.notes);
      if (text?.trim()) out.push({ target: e.name, notes: text });
    }
  } else if (def.state) {
    stateNotes(def.state, out);
  }
  return out;
}
