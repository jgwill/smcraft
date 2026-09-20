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

function stateNotes(state: StateDef, out: NoteEntry[]): void {
  if (state.notes?.trim()) out.push({ target: state.name, notes: state.notes });
  for (const child of state.states ?? []) stateNotes(child, out);
  for (const region of state.parallel?.states ?? []) stateNotes(region, out);
}

export function collectNotes(def: StateMachineDefinition | EntityRelationshipDefinition): NoteEntry[] {
  const out: NoteEntry[] = [];
  if (def.settings?.notes?.trim()) out.push({ target: null, notes: def.settings.notes });
  if (isErdDefinition(def)) {
    for (const e of def.entities ?? []) if (e?.notes?.trim()) out.push({ target: e.name, notes: e.notes });
  } else if (def.state) {
    stateNotes(def.state, out);
  }
  return out;
}
