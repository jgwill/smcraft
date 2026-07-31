/**
 * Pure, deterministic ASCII rendering of a state-machine definition.
 *
 * An indented tree of the state hierarchy; each transition is drawn beneath its
 * owning state as `─[event]→ target`. States present in `active` (the live
 * runtime set) are prefixed with `●`. No randomness, no clock, no I/O — the same
 * def always renders the same string.
 */
import type { StateDef, StateMachineDefinition } from "../definition.js";

function renderState(state: StateDef, depth: number, active: Set<string>, lines: string[]): void {
  const indent = "  ".repeat(depth);
  const marker = active.has(state.name) ? "● " : "";
  const kind = state.kind && state.kind !== "normal" ? ` <${state.kind}>` : "";
  lines.push(`${indent}${marker}${state.name}${kind}`);

  for (const t of state.transitions ?? []) {
    const guard = t.condition ? ` [${t.condition}]` : "";
    const target = t.nextState ?? "(internal)";
    lines.push(`${indent}  ─[${t.event}]→ ${target}${guard}`);
  }

  for (const child of state.states ?? []) {
    renderState(child, depth + 1, active, lines);
  }
}

/** Render `def` as an indented tree, marking states in `active` with `●`. */
export function renderAscii(def: StateMachineDefinition, active?: Set<string>): string {
  const lines: string[] = [];
  renderState(def.state, 0, active ?? new Set<string>(), lines);
  return lines.join("\n");
}
