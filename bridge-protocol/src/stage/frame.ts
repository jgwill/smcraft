/**
 * Where the camera goes for a focus — the boxes a step or a mark points at.
 *
 * A host passes the result to `fitToBoxes` and the canvas's `spotlight` prop.
 * A state machine also answers which level to draw: a nested state is shown
 * inside its parent, so the frame carries the drill path the canvas takes.
 * Nothing named that the drawing holds frames the whole level.
 */
import type { StateDef, StateMachineDefinition } from "../definition.js";
import type { LayoutBox } from "../autoLayout.js";
import type { Box } from "../viewport.js";
import type { SequenceLayout } from "../sequence/layout.js";

export interface StageFrame {
  /** The boxes to fit. Never empty when the drawing has anything in it. */
  boxes: Box[];
  /** True when the boxes are the focus; false when the focus missed and the whole level is framed. */
  focused: boolean;
}

export interface MachineFrame extends StageFrame {
  /** The drill path to draw: names below the root, `[]` for the top level. */
  path: string[];
}

function childrenOf(state: StateDef): StateDef[] {
  if (state.parallel) return state.parallel.states;
  return state.states ?? [];
}

function split(focus: string): { kind: string; name: string } | null {
  const i = focus.indexOf(":");
  return i > 0 ? { kind: focus.slice(0, i), name: focus.slice(i + 1) } : null;
}

/** The drill path whose level draws `name`: the names of its ancestors below the root. Null when absent. */
export function pathToState(root: StateDef, name: string): string[] | null {
  if (root.name === name) return [];
  const walk = (node: StateDef, trail: string[]): string[] | null => {
    for (const child of childrenOf(node)) {
      if (child.name === name) return trail;
      const found = walk(child, [...trail, child.name]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

function allStates(root: StateDef): StateDef[] {
  return [root, ...childrenOf(root).flatMap(allStates)];
}

function levelAt(root: StateDef, path: readonly string[]): StateDef[] {
  let current = root;
  for (const name of path) {
    const next = childrenOf(current).find((c) => c.name === name);
    if (!next) break;
    current = next;
  }
  return childrenOf(current);
}

/** The states a focus list names, directly or through a transition or an event, in order. */
export function machineStatesOf(def: StateMachineDefinition, focus: readonly string[]): string[] {
  const root = def.state;
  if (!root) return [];
  const states = allStates(root);
  const out: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !out.includes(name)) out.push(name);
  };
  for (const f of focus) {
    const parsed = split(f);
    if (!parsed) continue;
    if (parsed.kind === "state") add(parsed.name);
    else if (parsed.kind === "transition") {
      // `transition:<state>:<index>`, the id the canvas reports.
      const at = parsed.name.lastIndexOf(":");
      const source = at > 0 ? parsed.name.slice(0, at) : parsed.name;
      const index = at > 0 ? Number(parsed.name.slice(at + 1)) : NaN;
      const state = states.find((s) => s.name === source);
      add(state?.name);
      if (state && Number.isInteger(index)) add(state.transitions?.[index]?.nextState);
    } else if (parsed.kind === "event") {
      for (const s of states) {
        for (const t of s.transitions ?? []) {
          if (t.event === parsed.name) {
            add(s.name);
            add(t.nextState);
          }
        }
      }
    }
  }
  return out;
}

export function machineFrame(
  def: StateMachineDefinition,
  positions: Record<string, LayoutBox>,
  focus: readonly string[],
): MachineFrame {
  const root = def.state;
  if (!root) return { path: [], boxes: [], focused: false };
  const named = machineStatesOf(def, focus);
  const first = named.find((n) => pathToState(root, n) !== null);
  const path = first ? (pathToState(root, first) ?? []) : [];
  const level = levelAt(root, path);
  const onLevel = new Set(level.map((s) => s.name));
  const lit = named.filter((n) => onLevel.has(n)).map((n) => positions[n]).filter((b): b is LayoutBox => !!b);
  if (lit.length > 0) return { path, boxes: lit, focused: true };
  return { path, boxes: level.map((s) => positions[s.name]).filter((b): b is LayoutBox => !!b), focused: false };
}

/** `entity:Name` and `attribute:Entity.field` frame their entity. */
export function erdFrame(positions: Record<string, LayoutBox>, focus: readonly string[]): StageFrame {
  const names: string[] = [];
  for (const f of focus) {
    const parsed = split(f);
    if (!parsed) continue;
    const name = parsed.kind === "entity" ? parsed.name : parsed.kind === "attribute" ? parsed.name.split(".")[0] : "";
    if (name && positions[name] && !names.includes(name)) names.push(name);
  }
  if (names.length > 0) return { boxes: names.map((n) => positions[n]), focused: true };
  return { boxes: Object.values(positions), focused: false };
}

/** Half the height a message row is framed with, around its line. */
const ROW_HALF = 26;

/** `participant:Name` frames its header, `message:9` its row between the two lifelines. */
export function sequenceFrame(layout: SequenceLayout, focus: readonly string[]): StageFrame {
  const boxes: Box[] = [];
  for (const f of focus) {
    const parsed = split(f);
    if (!parsed) continue;
    if (parsed.kind === "participant") {
      const p = layout.participants.find((b) => b.name === parsed.name);
      if (p) boxes.push({ x: p.left, y: p.top, width: p.width, height: p.height });
    } else if (parsed.kind === "message") {
      const row = layout.rows.find((r) => r.ref === parsed.name);
      if (!row) continue;
      const left = Math.min(row.fromX, row.toX);
      const width = row.self ? 120 : Math.abs(row.toX - row.fromX);
      boxes.push({ x: left - 12, y: row.y - ROW_HALF, width: width + 24, height: ROW_HALF * 2 });
    }
  }
  if (boxes.length > 0) return { boxes, focused: true };
  return { boxes: [{ x: 0, y: 0, width: Math.max(1, layout.width), height: Math.max(1, layout.height) }], focused: false };
}
