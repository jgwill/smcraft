/**
 * SMDF Interpreter — Machine (Spec 61 extension)
 *
 * Drives a state machine directly from its StateMachineDefinition,
 * no code generation required. This is the drive-path contract consumed
 * by external tools (e.g. forgewright's runtime bridge):
 *
 *   const machine = new Machine(definition);
 *   machine.state;                 // initial leaf state name
 *   const r = machine.send("go");  // { handled, changed, from, to, event }
 *   machine.done;                  // true once a final state is reached
 *
 * Semantics locked by ts/src/tests/machine.test.ts:
 * - Construction enters the initial state (first-child descent from root,
 *   skipping history pseudo-states).
 * - send() resolves the event from the current leaf upward through its
 *   ancestors; the deepest state declaring a matching transition wins.
 * - A transition without nextState is internal: handled, no state change.
 * - A transition targeting the current state resolves as internal
 *   (handled: true, changed: false) — no exit/re-entry.
 * - A transition targeting a composite state descends to its initial leaf.
 * - Guarded transitions (condition set) are skipped unless the guard
 *   passes. Default guard: truthy lookup of the condition string in
 *   options.context. Fail-closed when no context is provided.
 * - Reaching a state with kind "final" ends the machine; later sends
 *   return handled: false.
 * - `code` actions are NOT executed by the interpreter (they are strings
 *   for generated code). timerStart/timerStop actions run when the
 *   duration is numeric; a fired timer sends its timer event id.
 */

import type {
  ActionDef,
  StateDef,
  StateMachineDefinition,
  TransitionDef,
} from "./model.js";
import {
  enrich,
  validate,
  type EnrichedModel,
  type ValidationError,
} from "./parser.js";
import {
  Context,
  State,
  StateKind,
  TransitionHelper,
  type IObserver,
} from "./runtime.js";

// --- Transition enumeration ---

export interface TransitionEdge {
  /** Name of the state declaring the transition (may be composite/root). */
  from: string;
  /** Event id that triggers the transition. */
  event: string;
  /** Target state name; equals `from` for internal transitions. */
  to: string;
  /** True when the definition declares no nextState (action-only). */
  internal: boolean;
  condition?: string;
  description?: string;
}

/**
 * Enumerate every transition in the definition as flat edges,
 * including transitions declared on composite/root states and inside
 * parallel regions. Internal transitions surface as self-edges
 * (to === from) so graph ingest can represent them uniformly.
 */
export function listTransitions(definition: StateMachineDefinition): TransitionEdge[] {
  const edges: TransitionEdge[] = [];

  function walk(state: StateDef): void {
    for (const t of state.transitions ?? []) {
      edges.push({
        from: state.name,
        event: t.event,
        to: t.nextState ?? state.name,
        internal: !t.nextState,
        condition: t.condition,
        description: t.description,
      });
    }
    for (const child of state.states ?? []) walk(child);
    if (state.parallel) {
      for (const region of state.parallel.states) walk(region);
    }
  }

  walk(definition.state);
  return edges;
}

// --- Machine ---

export interface SendResult {
  /** A matching, guard-passing transition was found and processed. */
  handled: boolean;
  /** The current leaf state changed (false for internal/self transitions). */
  changed: boolean;
  from: string;
  to: string;
  event: string;
  /** Reason when handled is false. */
  error?: string;
}

export type GuardFn = (
  condition: string,
  payload: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
) => boolean;

export interface MachineOptions {
  name?: string;
  observer?: IObserver;
  /** Guard context: default guard treats condition strings as truthy keys. */
  context?: Record<string, unknown>;
  guard?: GuardFn;
  /**
   * Validate the definition on construction (default true). Fatal rules
   * (V001 no root, V002 duplicate state, V006 unknown nextState) always
   * throw MachineDefinitionError; other findings land in `warnings`.
   */
  validate?: boolean;
}

export class MachineDefinitionError extends Error {
  errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(
      `Definition cannot be interpreted: ${errors
        .map((e) => `${e.ruleId} ${e.message}`)
        .join("; ")}`,
    );
    this.name = "MachineDefinitionError";
    this.errors = errors;
  }
}

const FATAL_RULES = new Set(["V001", "V002", "V006"]);

class DefState extends State {
  constructor(
    private def: StateDef,
    kind: StateKind,
    parent: State | null,
    private machine: Machine,
  ) {
    super(def.name, kind, parent);
  }

  onEntry(): void {
    this.machine.runActions(this.def.onEntry?.actions);
  }

  onExit(): void {
    this.machine.runActions(this.def.onExit?.actions);
  }
}

export class Machine extends Context {
  readonly definition: StateMachineDefinition;
  readonly model: EnrichedModel;
  /** Non-fatal validation findings (e.g. V007 final state with transitions). */
  readonly warnings: ValidationError[] = [];
  /** Leaf state names visited, in order, starting with the initial state. */
  visited: string[] = [];

  private stateObjects = new Map<string, State>();
  private guardFn: GuardFn;
  private guardContext: Record<string, unknown>;
  private ended = false;

  constructor(definition: StateMachineDefinition, options: MachineOptions = {}) {
    super(options.name ?? definition.settings?.name ?? "Machine");
    this.definition = definition;
    this.model = enrich(definition);

    if (options.validate !== false) {
      const errors = validate(this.model);
      const fatal = errors.filter((e) => FATAL_RULES.has(e.ruleId));
      if (fatal.length > 0) throw new MachineDefinitionError(fatal);
      this.warnings.push(...errors.filter((e) => !FATAL_RULES.has(e.ruleId)));
    }

    for (const s of this.model.allStates) {
      if (s.parallel) {
        throw new Error(
          `Machine interpreter does not support parallel regions yet (state "${s.name}")`,
        );
      }
    }

    this.guardContext = options.context ?? {};
    this.guardFn =
      options.guard ?? ((condition, _payload, ctx) => Boolean(ctx[condition]));
    if (options.observer) this.setObserver(options.observer);

    this.buildStateObjects();
    this.registerEndHandler(() => {
      this.ended = true;
      this.stopAllTimers();
    });
    this.enterInitialState();
  }

  // --- Introspection ---

  /** Current leaf state name. */
  get state(): string {
    return this.stateCurrent?.name ?? "";
  }

  /** State names from root to the current leaf. */
  get path(): string[] {
    const names: string[] = [];
    let s: State | null = this.stateCurrent;
    while (s) {
      names.unshift(s.name);
      s = s.parent;
    }
    return names;
  }

  /** True once a final state was reached (or stop() was called). */
  get done(): boolean {
    return this.ended;
  }

  /** Event ids with at least one transition declared on the current chain. */
  availableEvents(): string[] {
    const events = new Set<string>();
    let cursor = this.model.stateMap.get(this.state);
    while (cursor) {
      for (const t of cursor.transitions ?? []) events.add(t.event);
      const parentName = this.model.parentMap.get(cursor.name);
      cursor = parentName ? this.model.stateMap.get(parentName) : undefined;
    }
    return [...events];
  }

  // --- Lifecycle ---

  enterInitialState(): void {
    const leafDef = this.initialLeafOf(this.definition.state);
    const leaf = this.stateObjects.get(leafDef.name)!;

    const chain: State[] = [];
    let s: State | null = leaf;
    while (s) {
      chain.unshift(s);
      s = s.parent;
    }
    this.stateCurrent = leaf;
    for (const stateObj of chain) {
      this.observer.onEntry(this.name, stateObj.name);
      stateObj.onEntry(this);
    }
    this.visited = [leaf.name];
    if (leaf.kind === StateKind.FINAL) this.onEnd();
  }

  /**
   * Jump to a named state without firing exit/entry chains — used for
   * restoring persisted machines (deserialize). Composite targets
   * descend to their initial leaf. Throws on unknown state names.
   */
  setState(stateName: string): void {
    const def = this.model.stateMap.get(stateName);
    if (!def) throw new Error(`Unknown state "${stateName}"`);
    const leafDef = this.initialLeafOf(def);
    const leaf = this.stateObjects.get(leafDef.name)!;
    this.stateCurrent = leaf;
    this.ended = leaf.kind === StateKind.FINAL;
    if (this.visited[this.visited.length - 1] !== leaf.name) {
      this.visited.push(leaf.name);
    }
  }

  /** End the machine and release timers. Later sends are rejected. */
  stop(): void {
    if (!this.ended) this.onEnd();
  }

  // --- Drive path ---

  send(eventId: string, payload?: Record<string, unknown>): SendResult {
    const from = this.state;
    const rejected = (error: string): SendResult => ({
      handled: false,
      changed: false,
      from,
      to: from,
      event: eventId,
      error,
    });

    if (this.ended) return rejected("machine has reached a final state");

    const match = this.resolve(eventId, payload);
    if (!match) {
      return rejected(`no transition for event "${eventId}" from state "${from}"`);
    }

    if (!match.transition.nextState) {
      this.runActions(match.transition.actions);
      return { handled: true, changed: false, from, to: from, event: eventId };
    }

    const targetDef = this.model.stateMap.get(match.transition.nextState)!;
    const targetLeaf = this.stateObjects.get(this.initialLeafOf(targetDef).name)!;
    const prev = this.stateCurrent!;

    if (targetLeaf === prev) {
      // Self-target resolves as internal: no exit/re-entry.
      this.runActions(match.transition.actions);
      return { handled: true, changed: false, from, to: from, event: eventId };
    }

    const transitionName = match.transition.condition
      ? `${eventId}[${match.transition.condition}]`
      : eventId;

    TransitionHelper.processTransitionBegin(this, prev, targetLeaf, transitionName);
    this.runActions(match.transition.actions);
    this.stateCurrent = targetLeaf;
    TransitionHelper.processTransitionEnd(this, prev, targetLeaf);
    this.visited.push(targetLeaf.name);

    return { handled: true, changed: true, from, to: targetLeaf.name, event: eventId };
  }

  /** True when send(eventId, payload) would be handled, without side effects. */
  can(eventId: string, payload?: Record<string, unknown>): boolean {
    return !this.ended && this.resolve(eventId, payload) !== null;
  }

  // --- Internals ---

  private resolve(
    eventId: string,
    payload?: Record<string, unknown>,
  ): { owner: StateDef; transition: TransitionDef } | null {
    let cursor = this.model.stateMap.get(this.state);
    while (cursor) {
      for (const t of cursor.transitions ?? []) {
        if (t.event !== eventId) continue;
        if (t.condition && !this.guardFn(t.condition, payload, this.guardContext)) {
          continue;
        }
        return { owner: cursor, transition: t };
      }
      const parentName = this.model.parentMap.get(cursor.name);
      cursor = parentName ? this.model.stateMap.get(parentName) : undefined;
    }
    return null;
  }

  private buildStateObjects(): void {
    // collectStates order guarantees parents precede children.
    for (const def of this.model.allStates) {
      const parentName = this.model.parentMap.get(def.name);
      const parent = parentName ? this.stateObjects.get(parentName) ?? null : null;
      this.stateObjects.set(def.name, new DefState(def, this.kindOf(def, parentName ?? null), parent, this));
    }
  }

  private kindOf(def: StateDef, parentName: string | null): StateKind {
    if (parentName === null) return StateKind.ROOT;
    if (def.kind === "final") return StateKind.FINAL;
    if (def.kind === "history") return StateKind.HISTORY;
    if (def.states?.length) return StateKind.COMPOSITE;
    return StateKind.LEAF;
  }

  private initialLeafOf(def: StateDef): StateDef {
    if (!def.states?.length) return def;
    const child = def.states.find((s) => s.kind !== "history");
    if (!child) {
      throw new Error(`State "${def.name}" has no enterable child state`);
    }
    return this.initialLeafOf(child);
  }

  /** @internal — invoked by DefState entry/exit hooks and transitions. */
  runActions(actions: ActionDef[] | undefined): void {
    for (const action of actions ?? []) {
      if (action.timerStart) {
        const durationMs = Number(action.timerStart.duration);
        if (!Number.isFinite(durationMs)) continue; // expression durations need generated code
        const timerName = action.timerStart.timer;
        const eventId = this.model.timerMap.get(timerName)?.id ?? timerName;
        this.startTimer(timerName, durationMs, () => {
          this.send(eventId);
        });
      } else if (action.timerStop) {
        this.stopTimer(action.timerStop);
      }
      // `code` actions are strings for generated code; not interpreted.
    }
  }
}
