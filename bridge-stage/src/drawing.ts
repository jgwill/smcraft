/**
 * A drawing as the stage holds it: its path, what kind it is, and the
 * definition in the shape the canvas for that kind takes.
 */
import {
  docKindOfContent,
  docKindOfPath,
  isErdDefinition,
  isSequenceDefinition,
  normalizeNotes,
  type DocKind,
  type EntityRelationshipDefinition,
  type SequenceDefinition,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";

/** One file the host hands the stage. */
export interface StageDrawing {
  /** The path tours and marks name it by, relative to their folder (`screenwalk.smdf.json`). */
  path: string;
  /** The file's parsed JSON. A state machine may be bare or wrapped in `stateMachine`. */
  doc: unknown;
  /** What the drawing is called on its tab. Defaults to the file name without its extension. */
  label?: string;
}

export type LoadedDrawing =
  | { path: string; label: string; kind: "machine"; def: StateMachineDefinition }
  | { path: string; label: string; kind: "erd"; def: EntityRelationshipDefinition }
  | { path: string; label: string; kind: "sequence"; def: SequenceDefinition };

export function drawingLabel(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(smdf|erdf|sqdf|sysdf)\.json$/i, "").replace(/\.json$/i, "");
}

/**
 * The drawing the canvas can draw, or why not. A system file is not a drawing:
 * the host opens its members instead.
 */
export function loadDrawing(drawing: StageDrawing): { drawing: LoadedDrawing | null; reason?: string } {
  const label = drawing.label ?? drawingLabel(drawing.path);
  const doc = drawing.doc as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") return { drawing: null, reason: "the file is not a JSON object" };
  const byPath: DocKind = docKindOfPath(drawing.path);
  const kind = byPath === "machine" ? (docKindOfContent(doc) ?? byPath) : byPath;
  if (kind === "system") return { drawing: null, reason: "a system names drawings; open one of its members" };
  if (kind === "erd") {
    return isErdDefinition(doc)
      ? { drawing: { path: drawing.path, label, kind, def: doc } }
      : { drawing: null, reason: "not an entity-relationship document" };
  }
  if (kind === "sequence") {
    return isSequenceDefinition(doc)
      ? { drawing: { path: drawing.path, label, kind, def: doc } }
      : { drawing: null, reason: "not a sequence document" };
  }
  const machine = (doc.stateMachine ?? doc.StateMachine ?? doc) as StateMachineDefinition;
  if (!machine || typeof machine !== "object" || !("state" in machine) || !machine.state) {
    return { drawing: null, reason: "not a state machine: there is no root state" };
  }
  const def = normalizeNotes({ ...machine, events: machine.events ?? [] });
  return { drawing: { path: drawing.path, label, kind: "machine", def } };
}
