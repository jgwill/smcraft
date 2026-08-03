/**
 * State Machine Definition Parser (Spec 60)
 *
 * Parses JSON definitions into StateMachineDefinition objects.
 * Validates against the rules defined in Spec 60.
 */

import {
  type StateMachineDefinition,
  type StateDef,
  type EventDef,
  type TimerDef,
  type ParameterDef,
} from "./model.js";

export interface ValidationError {
  ruleId: string;
  message: string;
  element?: string;
}

export interface EnrichedModel {
  definition: StateMachineDefinition;
  stateMap: Map<string, StateDef>;
  eventMap: Map<string, EventDef>;
  timerMap: Map<string, TimerDef>;
  feedersMap: Map<string, EventDef[]>;
  parentMap: Map<string, string | null>;
  allStates: StateDef[];
  leafStates: StateDef[];
  compositeStates: StateDef[];
}

/**
 * Accept both shapes a `.smdf.json` is written in.
 *
 * The design surfaces — `smcx`, the MCP server, the hub — persist canonically
 * as `{ "stateMachine": { … } }`, while `examples/` and hand-authored files
 * carry the bare `{ settings, events, state }`. Both are real documents in the
 * wild, and an engine that reads only one of them breaks the workflow the whole
 * system is for: design through the loom, then generate code from what you
 * designed. The failure was silent in the worst way — V001 "No root state
 * defined" against a file whose root state is plainly there, one level down.
 *
 * `StateMachine` is honored too; the C# StateForge lineage capitalized it.
 */
export function unwrapDefinition(parsed: unknown): StateMachineDefinition {
  const doc = parsed as Record<string, unknown> | null;
  if (doc && typeof doc === "object") {
    const inner = doc.stateMachine ?? doc.StateMachine;
    if (inner && typeof inner === "object") return inner as StateMachineDefinition;
  }
  return parsed as StateMachineDefinition;
}

export function parseJson(content: string): StateMachineDefinition {
  return unwrapDefinition(JSON.parse(content));
}

export function parseFile(filePath: string): StateMachineDefinition {
  // Lazy built-in lookup: keeps this module loadable in browsers and ESM
  // (a top-level `require` crashes under "type": "module").
  const fs =
    typeof process !== "undefined" ? process.getBuiltinModule?.("node:fs") : undefined;
  if (!fs) {
    throw new Error("parseFile requires a Node.js runtime (>= 22.3); use parseJson instead");
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return parseJson(content);
}

export function enrich(definition: StateMachineDefinition): EnrichedModel {
  const model: EnrichedModel = {
    definition,
    stateMap: new Map(),
    eventMap: new Map(),
    timerMap: new Map(),
    feedersMap: new Map(),
    parentMap: new Map(),
    allStates: [],
    leafStates: [],
    compositeStates: [],
  };

  // Build event/timer maps
  for (const es of definition.events ?? []) {
    for (const evt of es.events ?? []) {
      model.eventMap.set(evt.id, evt);
      if (es.feeder) {
        if (!model.feedersMap.has(es.feeder)) model.feedersMap.set(es.feeder, []);
        model.feedersMap.get(es.feeder)!.push(evt);
      }
    }
    for (const timer of es.timers ?? []) {
      model.timerMap.set(timer.name, timer);
      const timerEvt: EventDef = {
        id: timer.id,
        name: timer.name,
        parameters: [{ name: "source", type: "object" }],
      };
      model.eventMap.set(timer.id, timerEvt);
      if (es.feeder) {
        if (!model.feedersMap.has(es.feeder)) model.feedersMap.set(es.feeder, []);
        model.feedersMap.get(es.feeder)!.push(timerEvt);
      }
    }
  }

  // Build state map
  if (definition.state) {
    collectStates(definition.state, null, model);
  }

  return model;
}

function collectStates(state: StateDef, parentName: string | null, model: EnrichedModel): void {
  model.stateMap.set(state.name, state);
  model.parentMap.set(state.name, parentName);
  model.allStates.push(state);

  const isLeaf = !state.states?.length && !state.parallel;
  const isComposite = (state.states?.length ?? 0) > 0;

  if (isLeaf && !state.parallel) model.leafStates.push(state);
  if (isComposite) model.compositeStates.push(state);

  for (const child of state.states ?? []) {
    collectStates(child, state.name, model);
  }
  if (state.parallel) {
    for (const region of state.parallel.states) {
      collectStates(region, state.name, model);
    }
  }
}

export function validate(model: EnrichedModel): ValidationError[] {
  const errors: ValidationError[] = [];
  const defn = model.definition;

  // V001
  if (!defn.state) {
    errors.push({ ruleId: "V001", message: "No root state defined" });
  }

  // V002
  const seenStates = new Set<string>();
  for (const s of model.allStates) {
    if (seenStates.has(s.name)) {
      errors.push({ ruleId: "V002", message: `Duplicate state name: ${s.name}`, element: s.name });
    }
    seenStates.add(s.name);
  }

  // V003
  const seenEvents = new Set<string>();
  for (const es of defn.events ?? []) {
    for (const evt of es.events ?? []) {
      if (seenEvents.has(evt.id)) {
        errors.push({ ruleId: "V003", message: `Duplicate event ID: ${evt.id}`, element: evt.id });
      }
      seenEvents.add(evt.id);
    }
  }

  // V005: Transition events reference defined events
  for (const state of model.allStates) {
    for (const t of state.transitions ?? []) {
      if (!model.eventMap.has(t.event)) {
        errors.push({ ruleId: "V005", message: `Undefined event: ${t.event}`, element: state.name });
      }
    }
  }

  // V006: Transition nextState references defined states
  for (const state of model.allStates) {
    for (const t of state.transitions ?? []) {
      if (t.nextState && !model.stateMap.has(t.nextState)) {
        errors.push({ ruleId: "V006", message: `Undefined state: ${t.nextState}`, element: state.name });
      }
    }
  }

  // V007: Final states have no transitions
  for (const state of model.allStates) {
    if (state.kind === "final" && (state.transitions?.length ?? 0) > 0) {
      errors.push({ ruleId: "V007", message: `Final state has transitions: ${state.name}`, element: state.name });
    }
  }

  // V013
  if (!defn.events?.length) {
    errors.push({ ruleId: "V013", message: "No event sources defined" });
  }

  return errors;
}
