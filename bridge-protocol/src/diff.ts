/**
 * Minimal, ordered diff of two SMDF definitions into a PatchOp list.
 *
 * The op ordering guarantees that `applyPatchOps` never references a target
 * that has not yet been created:
 *   1. settings   — one `settings.update` with only the changed keys.
 *   2. events     — sources by index, then per-source events (by id), then
 *                   parameters (by index).
 *   3. states     — additions parents-before-children, then reparenting, then
 *                   surviving-state scalar/action/transition diffs, then added
 *                   states' transitions, then removals children-before-parents
 *                   (transition.remove before state.remove).
 *
 * `runtime.*` ops are never emitted.
 *
 * Shape convention: definitions follow "omit-when-empty" (no empty `states` /
 * `transitions` / `parameters` arrays, no empty `onEntry` / `onExit`). The diff
 * treats a missing container as empty, and `applyPatchOps` prunes emptied
 * containers, so the round-trip stays structurally exact.
 *
 * Assumptions (held by well-formed edit streams and the generator/fixtures):
 *   - state `name` and event `id` are stable keys; surviving siblings keep
 *     their relative order (no reorder op exists);
 *   - new siblings are appended after surviving ones; reparented states are
 *     appended under their new parent;
 *   - scalar fields are changed or added, not deleted (merge cannot delete).
 */
import type {
  StateMachineDefinition,
  SettingsModel,
  StateDef,
  EventSourceDef,
  EventDef,
  ParameterDef,
  TransitionDef,
  ActionDef,
} from "./definition.js";
import type { PatchOp } from "./ops.js";
import { collectAllStates, buildParentMap } from "./tree.js";

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Baseline used when `prev` is null: an empty machine sharing next's root name. */
function emptyBaseline(next: StateMachineDefinition): StateMachineDefinition {
  return {
    settings: { namespace: '', asynchronous: false },
    events: [],
    state: { name: next.state.name, states: [] },
  };
}

export function diffDefinition(
  prev: StateMachineDefinition | null,
  next: StateMachineDefinition,
): PatchOp[] {
  const base = prev ?? emptyBaseline(next);
  const ops: PatchOp[] = [];
  diffSettings(base, next, ops);
  diffEvents(base, next, ops);
  diffStates(base, next, ops);
  return ops;
}

// --- settings -------------------------------------------------------------

function diffSettings(
  prev: StateMachineDefinition,
  next: StateMachineDefinition,
  ops: PatchOp[],
): void {
  const patch: Partial<SettingsModel> = {};
  let changed = false;
  const keys = new Set<string>([
    ...Object.keys(prev.settings),
    ...Object.keys(next.settings),
  ]);
  const pvAll = prev.settings as unknown as Record<string, unknown>;
  const nvAll = next.settings as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (!eq(pvAll[key], nvAll[key]) && nvAll[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = nvAll[key];
      changed = true;
    }
  }
  if (changed) ops.push({ op: 'settings.update', patch });
}

// --- events ---------------------------------------------------------------

function diffEvents(
  prev: StateMachineDefinition,
  next: StateMachineDefinition,
  ops: PatchOp[],
): void {
  const pe = prev.events;
  const ne = next.events;
  const common = Math.min(pe.length, ne.length);

  for (let i = 0; i < common; i++) {
    diffOneSource(i, pe[i], ne[i], ops);
  }
  // added sources (appended)
  for (let i = pe.length; i < ne.length; i++) {
    ops.push({ op: 'eventSource.add', source: ne[i] });
  }
  // removed sources (descending index)
  for (let i = pe.length - 1; i >= ne.length; i--) {
    ops.push({ op: 'eventSource.remove', index: i });
  }
}

function diffOneSource(
  sourceIndex: number,
  ps: EventSourceDef,
  ns: EventSourceDef,
  ops: PatchOp[],
): void {
  // scalar / timers update (never includes the `events` array)
  const patch: Partial<EventSourceDef> = {};
  let changed = false;
  for (const key of ['name', 'file', 'feeder', 'description', 'timers'] as const) {
    if (!eq(ps[key], ns[key]) && ns[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = ns[key];
      changed = true;
    }
  }
  if (changed) ops.push({ op: 'eventSource.update', index: sourceIndex, patch });

  const pev = ps.events ?? [];
  const nev = ns.events ?? [];
  const nextIds = new Set(nev.map((e) => e.id));

  // removals by id
  for (const e of pev) {
    if (!nextIds.has(e.id)) ops.push({ op: 'event.remove', id: e.id });
  }

  // reconcile surviving events -> next, inserting new ones at their index
  const work = pev.filter((e) => nextIds.has(e.id));
  let j = 0;
  while (j < nev.length) {
    const target = nev[j];
    if (j < work.length && work[j].id === target.id) {
      diffEventScalars(work[j], target, ops);
      diffParameters(target.id, work[j].parameters ?? [], target.parameters ?? [], ops);
      j++;
    } else {
      ops.push({ op: 'event.add', sourceIndex, event: target, index: j });
      work.splice(j, 0, target);
      j++;
    }
  }
}

function diffEventScalars(prev: EventDef, next: EventDef, ops: PatchOp[]): void {
  const patch: Partial<EventDef> = {};
  let changed = false;
  for (const key of ['name', 'description', 'preAction', 'postAction'] as const) {
    if (!eq(prev[key], next[key]) && next[key] !== undefined) {
      (patch as Record<string, unknown>)[key] = next[key];
      changed = true;
    }
  }
  if (changed) ops.push({ op: 'event.update', id: next.id, patch });
}

function diffParameters(
  eventId: string,
  pp: ParameterDef[],
  np: ParameterDef[],
  ops: PatchOp[],
): void {
  const common = Math.min(pp.length, np.length);
  for (let k = 0; k < common; k++) {
    if (!eq(pp[k], np[k])) {
      const patch: Partial<ParameterDef> = {};
      if (pp[k].name !== np[k].name) patch.name = np[k].name;
      if (pp[k].type !== np[k].type) patch.type = np[k].type;
      ops.push({ op: 'parameter.update', eventId, index: k, patch });
    }
  }
  for (let k = common; k < np.length; k++) {
    ops.push({ op: 'parameter.add', eventId, parameter: np[k], index: k });
  }
  for (let k = pp.length - 1; k >= np.length; k--) {
    ops.push({ op: 'parameter.remove', eventId, index: k });
  }
}

// --- states ---------------------------------------------------------------

function diffStates(
  prev: StateMachineDefinition,
  next: StateMachineDefinition,
  ops: PatchOp[],
): void {
  const prevStates = collectAllStates(prev.state); // pre-order (parents first)
  const nextStates = collectAllStates(next.state);
  const prevByName = new Map(prevStates.map((s) => [s.name, s]));
  const nextByName = new Map(nextStates.map((s) => [s.name, s]));
  const prevParent = buildParentMap(prev.state);
  const nextParent = buildParentMap(next.state);

  const addedTransitions: { state: string; transitions: TransitionDef[] }[] = [];

  // 1. additions — pre-order keeps parents before children
  for (const state of nextStates) {
    if (prevByName.has(state.name)) continue;
    const parent = nextParent.get(state.name) ?? null;
    const { states: _children, transitions, ...rest } = state;
    void _children;
    ops.push({ op: 'state.add', parent, state: { ...rest } as StateDef });
    if (transitions && transitions.length > 0) {
      addedTransitions.push({ state: state.name, transitions });
    }
  }

  // 2. reparenting — surviving states whose parent changed
  for (const state of nextStates) {
    if (!prevByName.has(state.name)) continue;
    const before = prevParent.get(state.name) ?? null;
    const after = nextParent.get(state.name) ?? null;
    if (before !== after && after !== null) {
      ops.push({ op: 'state.nest', child: state.name, newParent: after });
    }
  }

  // 3. surviving states — scalar + action diffs
  for (const state of nextStates) {
    const before = prevByName.get(state.name);
    if (!before) continue;

    const patch: Partial<Omit<StateDef, 'states' | 'transitions'>> = {};
    let changed = false;
    if (!eq(before.kind, state.kind) && state.kind !== undefined) {
      patch.kind = state.kind;
      changed = true;
    }
    if (!eq(before.description, state.description) && state.description !== undefined) {
      patch.description = state.description;
      changed = true;
    }
    if (changed) ops.push({ op: 'state.update', name: state.name, patch });

    diffActions(state.name, 'onEntry', before.onEntry?.actions ?? [], state.onEntry?.actions ?? [], ops);
    diffActions(state.name, 'onExit', before.onExit?.actions ?? [], state.onExit?.actions ?? [], ops);
  }

  // 4. transitions for newly added states (state exists now)
  for (const added of addedTransitions) {
    added.transitions.forEach((transition, index) => {
      ops.push({ op: 'transition.add', state: added.state, transition, index });
    });
  }

  // 5. surviving-state transition diffs (by index)
  for (const state of nextStates) {
    const before = prevByName.get(state.name);
    if (!before) continue;
    diffTransitions(state.name, before.transitions ?? [], state.transitions ?? [], ops);
  }

  // 6. removals — reverse pre-order (children before parents), transitions first
  for (let i = prevStates.length - 1; i >= 0; i--) {
    const state = prevStates[i];
    if (nextByName.has(state.name)) continue;
    const transitions = state.transitions ?? [];
    for (let k = transitions.length - 1; k >= 0; k--) {
      ops.push({ op: 'transition.remove', state: state.name, index: k });
    }
    ops.push({ op: 'state.remove', name: state.name });
  }
}

function diffActions(
  state: string,
  hook: 'onEntry' | 'onExit',
  pa: ActionDef[],
  na: ActionDef[],
  ops: PatchOp[],
): void {
  const common = Math.min(pa.length, na.length);
  for (let k = 0; k < common; k++) {
    if (!eq(pa[k], na[k])) {
      ops.push({ op: 'action.update', state, hook, index: k, action: na[k] });
    }
  }
  for (let k = common; k < na.length; k++) {
    ops.push({ op: 'action.add', state, hook, action: na[k], index: k });
  }
  for (let k = pa.length - 1; k >= na.length; k--) {
    ops.push({ op: 'action.remove', state, hook, index: k });
  }
}

function diffTransitions(
  state: string,
  pt: TransitionDef[],
  nt: TransitionDef[],
  ops: PatchOp[],
): void {
  const common = Math.min(pt.length, nt.length);
  for (let k = 0; k < common; k++) {
    if (eq(pt[k], nt[k])) continue;
    const patch: Partial<TransitionDef> = {};
    for (const key of ['event', 'nextState', 'condition', 'description', 'actions'] as const) {
      if (!eq(pt[k][key], nt[k][key]) && nt[k][key] !== undefined) {
        (patch as Record<string, unknown>)[key] = nt[k][key];
      }
    }
    if (Object.keys(patch).length > 0) {
      ops.push({ op: 'transition.update', state, index: k, patch });
    }
  }
  for (let k = common; k < nt.length; k++) {
    ops.push({ op: 'transition.add', state, transition: nt[k], index: k });
  }
  for (let k = pt.length - 1; k >= nt.length; k--) {
    ops.push({ op: 'transition.remove', state, index: k });
  }
}
