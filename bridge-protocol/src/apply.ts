/**
 * Pure application of PatchOps to an SMDF definition.
 *
 * `applyPatchOps` deep-clones its input and never mutates the original. Ops are
 * applied in order. `runtime.enter` / `runtime.exit` are presentational and are
 * ignored (the definition is returned unchanged for those).
 *
 * Removal ops prune now-empty containers (e.g. an emptied `states` /
 * `transitions` / `parameters` array, or an emptied `onEntry` / `onExit`) so
 * the result honours the canonical "omit-when-empty" SMDF shape. This keeps
 * `applyPatchOps(prev, diffDefinition(prev, next))` structurally equal to
 * `next` rather than leaving stray empty arrays behind.
 */
import type {
  StateMachineDefinition,
  StateDef,
  EventSourceDef,
  EventDef,
} from "./definition.js";
import type { PatchOp } from "./ops.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findState(root: StateDef, name: string): StateDef | null {
  if (root.name === name) return root;
  for (const child of root.states ?? []) {
    const found = findState(child, name);
    if (found) return found;
  }
  return null;
}

/** The StateDef that directly contains `name`, or null if `name` is the root / absent. */
function findParent(root: StateDef, name: string): StateDef | null {
  for (const child of root.states ?? []) {
    if (child.name === name) return root;
    const found = findParent(child, name);
    if (found) return found;
  }
  return null;
}

function requireState(root: StateDef, name: string, op: string): StateDef {
  const state = findState(root, name);
  if (!state) throw new Error(`applyPatchOps: ${op} references missing state "${name}"`);
  return state;
}

interface EventLocation {
  source: EventSourceDef;
  event: EventDef;
  index: number;
}

function findEvent(def: StateMachineDefinition, id: string): EventLocation | null {
  for (const source of def.events) {
    const events = source.events ?? [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].id === id) return { source, event: events[i], index: i };
    }
  }
  return null;
}

function requireEvent(def: StateMachineDefinition, id: string, op: string): EventLocation {
  const found = findEvent(def, id);
  if (!found) throw new Error(`applyPatchOps: ${op} references missing event "${id}"`);
  return found;
}

export function applyPatchOps(
  def: StateMachineDefinition,
  ops: PatchOp[],
): StateMachineDefinition {
  const next = clone(def);

  for (const op of ops) {
    switch (op.op) {
      case 'settings.update': {
        next.settings = { ...next.settings, ...op.patch };
        break;
      }

      case 'state.add': {
        const parent = op.parent === null
          ? next.state
          : requireState(next.state, op.parent, 'state.add');
        if (!parent.states) parent.states = [];
        const index = op.index ?? parent.states.length;
        parent.states.splice(index, 0, clone(op.state));
        break;
      }

      case 'state.update': {
        const state = requireState(next.state, op.name, 'state.update');
        Object.assign(state, op.patch);
        break;
      }

      case 'state.remove': {
        if (next.state.name === op.name) {
          throw new Error(`applyPatchOps: cannot remove root state "${op.name}"`);
        }
        const parent = findParent(next.state, op.name);
        if (!parent || !parent.states) {
          throw new Error(`applyPatchOps: state.remove references missing state "${op.name}"`);
        }
        const index = parent.states.findIndex((s) => s.name === op.name);
        if (index < 0) {
          throw new Error(`applyPatchOps: state.remove references missing state "${op.name}"`);
        }
        parent.states.splice(index, 1);
        if (parent.states.length === 0) delete parent.states;
        break;
      }

      case 'state.nest': {
        const child = requireState(next.state, op.child, 'state.nest');
        const newParent = requireState(next.state, op.newParent, 'state.nest');
        const currentParent = findParent(next.state, op.child);
        if (!currentParent || !currentParent.states) {
          throw new Error(`applyPatchOps: state.nest cannot detach root or missing state "${op.child}"`);
        }
        const childIndex = currentParent.states.findIndex((s) => s.name === op.child);
        const [moved] = currentParent.states.splice(childIndex, 1);
        if (currentParent.states.length === 0) delete currentParent.states;
        if (!newParent.states) newParent.states = [];
        newParent.states.push(moved ?? clone(child));
        break;
      }

      case 'eventSource.add': {
        const index = op.index ?? next.events.length;
        next.events.splice(index, 0, clone(op.source));
        break;
      }

      case 'eventSource.update': {
        const source = next.events[op.index];
        if (!source) throw new Error(`applyPatchOps: eventSource.update index ${op.index} out of range`);
        next.events[op.index] = { ...source, ...op.patch };
        break;
      }

      case 'eventSource.remove': {
        if (!next.events[op.index]) {
          throw new Error(`applyPatchOps: eventSource.remove index ${op.index} out of range`);
        }
        next.events.splice(op.index, 1);
        break;
      }

      case 'event.add': {
        const source = next.events[op.sourceIndex];
        if (!source) throw new Error(`applyPatchOps: event.add sourceIndex ${op.sourceIndex} out of range`);
        if (!source.events) source.events = [];
        const index = op.index ?? source.events.length;
        source.events.splice(index, 0, clone(op.event));
        break;
      }

      case 'event.update': {
        const found = requireEvent(next, op.id, 'event.update');
        Object.assign(found.event, op.patch);
        break;
      }

      case 'event.remove': {
        const found = requireEvent(next, op.id, 'event.remove');
        found.source.events!.splice(found.index, 1);
        if (found.source.events!.length === 0) delete found.source.events;
        break;
      }

      case 'parameter.add': {
        const found = requireEvent(next, op.eventId, 'parameter.add');
        if (!found.event.parameters) found.event.parameters = [];
        const index = op.index ?? found.event.parameters.length;
        found.event.parameters.splice(index, 0, clone(op.parameter));
        break;
      }

      case 'parameter.update': {
        const found = requireEvent(next, op.eventId, 'parameter.update');
        const params = found.event.parameters ?? [];
        if (!params[op.index]) {
          throw new Error(`applyPatchOps: parameter.update index ${op.index} out of range for event "${op.eventId}"`);
        }
        params[op.index] = { ...params[op.index], ...op.patch };
        break;
      }

      case 'parameter.remove': {
        const found = requireEvent(next, op.eventId, 'parameter.remove');
        const params = found.event.parameters;
        if (!params || !params[op.index]) {
          throw new Error(`applyPatchOps: parameter.remove index ${op.index} out of range for event "${op.eventId}"`);
        }
        params.splice(op.index, 1);
        if (params.length === 0) delete found.event.parameters;
        break;
      }

      case 'transition.add': {
        const state = requireState(next.state, op.state, 'transition.add');
        if (!state.transitions) state.transitions = [];
        const index = op.index ?? state.transitions.length;
        state.transitions.splice(index, 0, clone(op.transition));
        break;
      }

      case 'transition.update': {
        const state = requireState(next.state, op.state, 'transition.update');
        const transitions = state.transitions ?? [];
        if (!transitions[op.index]) {
          throw new Error(`applyPatchOps: transition.update index ${op.index} out of range for state "${op.state}"`);
        }
        transitions[op.index] = { ...transitions[op.index], ...op.patch };
        break;
      }

      case 'transition.remove': {
        const state = requireState(next.state, op.state, 'transition.remove');
        const transitions = state.transitions;
        if (!transitions || !transitions[op.index]) {
          throw new Error(`applyPatchOps: transition.remove index ${op.index} out of range for state "${op.state}"`);
        }
        transitions.splice(op.index, 1);
        if (transitions.length === 0) delete state.transitions;
        break;
      }

      case 'action.add': {
        const state = requireState(next.state, op.state, 'action.add');
        const hook = state[op.hook] ?? (state[op.hook] = { actions: [] });
        const index = op.index ?? hook.actions.length;
        hook.actions.splice(index, 0, clone(op.action));
        break;
      }

      case 'action.update': {
        const state = requireState(next.state, op.state, 'action.update');
        const hook = state[op.hook];
        if (!hook || !hook.actions[op.index]) {
          throw new Error(`applyPatchOps: action.update index ${op.index} out of range for state "${op.state}" ${op.hook}`);
        }
        hook.actions[op.index] = clone(op.action);
        break;
      }

      case 'action.remove': {
        const state = requireState(next.state, op.state, 'action.remove');
        const hook = state[op.hook];
        if (!hook || !hook.actions[op.index]) {
          throw new Error(`applyPatchOps: action.remove index ${op.index} out of range for state "${op.state}" ${op.hook}`);
        }
        hook.actions.splice(op.index, 1);
        if (hook.actions.length === 0) delete state[op.hook];
        break;
      }

      case 'runtime.enter':
      case 'runtime.exit':
        // Presentational only — the definition is unchanged.
        break;

      default: {
        const exhaustive: never = op;
        throw new Error(`applyPatchOps: unknown op ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return next;
}
