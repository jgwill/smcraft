/**
 * State-tree traversal helpers.
 *
 * These mirror the web store's versions (`collectStateNames`,
 * `collectAllStates`, `collectEventIds`). `collectAllStates` performs a
 * pre-order DFS, so parents always appear before their children — a property
 * the diff engine relies on for ordering `state.add` ops.
 */
import type { StateDef, StateMachineDefinition } from "./definition.js";

export function collectStateNames(root: StateDef): string[] {
  const names = [root.name];
  for (const child of root.states ?? []) {
    names.push(...collectStateNames(child));
  }
  return names;
}

export function collectAllStates(root: StateDef): StateDef[] {
  const states = [root];
  for (const child of root.states ?? []) {
    states.push(...collectAllStates(child));
  }
  return states;
}

export function collectEventIds(def: StateMachineDefinition): string[] {
  return def.events.flatMap((source) => (source.events ?? []).map((e) => e.id));
}

/**
 * Map of state name -> its parent's name (null for the root). Built via
 * pre-order DFS. Used by the diff engine to detect reparenting.
 */
export function buildParentMap(root: StateDef): Map<string, string | null> {
  const map = new Map<string, string | null>();
  map.set(root.name, null);
  const walk = (node: StateDef): void => {
    for (const child of node.states ?? []) {
      map.set(child.name, node.name);
      walk(child);
    }
  };
  walk(root);
  return map;
}
