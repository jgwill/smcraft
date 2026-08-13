/**
 * Which states the board is showing right now.
 *
 * A machine is a tree, but a canvas draws one level of it: a parent's direct
 * children, with the arrows that run between them. Drilling into a composite
 * is nothing more than moving the parent one step down that tree, which is why
 * the whole of navigation here is a path of names and these three functions.
 *
 * Pure: no React, no DOM. The same path over the same definition always names
 * the same level.
 */
import type { StateDef, StateMachineDefinition } from "@miadi/stateloom-protocol";

/** A state's direct children — its `states`, or its parallel regions. */
export function childrenOf(state: StateDef): StateDef[] {
  if (state.parallel) return state.parallel.states;
  return state.states ?? [];
}

/** A named child of `parent`, one level down only. */
export function childByName(parent: StateDef, name: string): StateDef | null {
  return childrenOf(parent).find((child) => child.name === name) ?? null;
}

/** Anywhere in the subtree. Used to answer "what did the user just select?". */
export function findState(root: StateDef, name: string): StateDef | null {
  if (root.name === name) return root;
  for (const child of childrenOf(root)) {
    const found = findState(child, name);
    if (found) return found;
  }
  return null;
}

/**
 * The state whose children the canvas draws: `root` walked down `path`.
 *
 * A path naming something that no longer exists — a state renamed under a
 * breadcrumb still pointing at it — resolves to the deepest level that does,
 * so the board falls back toward the root instead of going blank.
 */
export function parentAt(root: StateDef, path: readonly string[]): StateDef {
  let current = root;
  for (const name of path) {
    const next = childByName(current, name);
    if (!next) return current;
    current = next;
  }
  return current;
}

/** The boxes drawn at `path`. */
export function childStatesAt(root: StateDef, path: readonly string[]): StateDef[] {
  return childrenOf(parentAt(root, path));
}

/** How much of `path` still resolves — what the breadcrumb may honestly show. */
export function livePath(root: StateDef, path: readonly string[]): string[] {
  const live: string[] = [];
  let current = root;
  for (const name of path) {
    const next = childByName(current, name);
    if (!next) break;
    live.push(name);
    current = next;
  }
  return live;
}

/** Every event id the definition declares, in declaration order, deduplicated. */
export function definedEvents(definition: StateMachineDefinition): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const source of definition.events ?? []) {
    for (const event of source.events ?? []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      ids.push(event.id);
    }
  }
  return ids;
}
