/**
 * Pure, deterministic Mermaid `stateDiagram-v2` rendering of a definition.
 *
 * Every transition becomes an `A --> B : event` edge (guards appended as
 * ` [cond]`), and a state that owns children becomes a `state Name { … }` block
 * holding the edges between those children.
 *
 * Where the edge is written is the whole game. Mermaid decides nesting by
 * scope: a state first mentioned outside a block belongs outside it, no matter
 * what the block says. Declaring `state Shooting { }` and then writing
 * `Setup --> Rolling` at the top level therefore draws an empty composite with
 * its children stranded beside it — which is what this renderer used to emit.
 * So each edge is written at the level of the state it leaves, and a child that
 * no edge at its level mentions gets a bare line of its own, because a state
 * mermaid never hears about is a state it never draws.
 *
 * Pure — no randomness, no clock, no I/O.
 */
import type { StateDef, StateMachineDefinition } from "../definition.js";

/** Direct children, de-duplicated by name (first declaration wins). */
function childrenOf(parent: StateDef): StateDef[] {
  const seen = new Set<string>();
  const out: StateDef[] = [];
  for (const child of parent.states ?? []) {
    if (seen.has(child.name)) continue;
    seen.add(child.name);
    out.push(child);
  }
  return out;
}

/**
 * One nesting level: the edges leaving these siblings, a bare declaration for
 * any sibling those edges never name, then a block per composite.
 */
function renderLevel(parent: StateDef, depth: number, lines: string[]): void {
  const children = childrenOf(parent);
  if (children.length === 0) return;
  const pad = "    ".repeat(depth + 1);
  const mentioned = new Set<string>();

  for (const child of children) {
    for (const t of child.transitions ?? []) {
      // A transition with no target fires without moving; mermaid has no edge
      // shape for it, and inventing one would draw a journey nobody takes.
      if (!t.nextState) continue;
      const label = t.condition ? `${t.event} [${t.condition}]` : t.event;
      lines.push(`${pad}${child.name} --> ${t.nextState} : ${label}`);
      mentioned.add(child.name);
      mentioned.add(t.nextState);
    }
  }

  for (const child of children) {
    if (!mentioned.has(child.name)) lines.push(`${pad}${child.name}`);
  }

  for (const child of children) {
    if (childrenOf(child).length === 0) continue;
    lines.push(`${pad}state ${child.name} {`);
    renderLevel(child, depth + 1, lines);
    lines.push(`${pad}}`);
  }
}

/** Render `def` as a Mermaid `stateDiagram-v2` string. */
export function renderMermaid(def: StateMachineDefinition): string {
  const lines: string[] = ["stateDiagram-v2"];
  if (def.state) renderLevel(def.state, 0, lines);
  return lines.join("\n");
}
