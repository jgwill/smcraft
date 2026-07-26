/**
 * Pure, deterministic Mermaid `stateDiagram-v2` rendering of a definition.
 *
 * Composite states become nested `state Name { … }` blocks; every transition
 * becomes an `A --> B : event` edge (guards appended as ` [cond]`). Pure — no
 * randomness, no clock, no I/O.
 */
import type { StateDef, StateMachineDefinition } from "@smcraft/bridge-protocol";

function declareComposites(state: StateDef, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth + 1);
  for (const child of state.states ?? []) {
    if (child.states && child.states.length > 0) {
      lines.push(`${indent}state ${child.name} {`);
      declareComposites(child, depth + 1, lines);
      lines.push(`${indent}}`);
    }
  }
}

function edges(state: StateDef, lines: string[]): void {
  for (const t of state.transitions ?? []) {
    if (!t.nextState) continue;
    const label = t.condition ? `${t.event} [${t.condition}]` : t.event;
    lines.push(`    ${state.name} --> ${t.nextState} : ${label}`);
  }
  for (const child of state.states ?? []) edges(child, lines);
}

/** Render `def` as a Mermaid `stateDiagram-v2` string. */
export function renderMermaid(def: StateMachineDefinition): string {
  const lines: string[] = ["stateDiagram-v2"];
  declareComposites(def.state, 0, lines);
  edges(def.state, lines);
  return lines.join("\n");
}
