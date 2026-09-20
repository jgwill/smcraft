/**
 * Canonical SMDF definition types owned by the bridge protocol.
 *
 * The protocol keeps its own dependency-free copy so downstream packages can
 * import it without pulling in `web` or `ts`. The shapes follow the *engine*
 * (`ts/src/model.ts`) — the code generator is what actually reads these fields,
 * so it is the authority on what they hold, and any copy that disagrees is the
 * one that drifted.
 */

/**
 * The generated context class. `class` is what `codegen.ts` reads to name it
 * (`settings.context?.class`); `className` — which the web designer wrote here
 * for a long time — was never read by anything. `baseClass` is the designer's
 * own extra and is carried through untouched.
 */
export interface ContextConfig {
  class?: string;
  instance?: string;
  baseClass?: string;
}

/** An object the generated context is constructed with. Read by `codegen.ts`. */
export interface ObjectRef {
  instance: string;
  class: string;
  namespace?: string;
}

export interface SettingsModel {
  namespace: string;
  name?: string;
  description?: string;
  /**
   * Working notes about the whole diagram — what a person or an agent wrote
   * down while discussing it, for whoever opens it next. Not part of the
   * machine: the engines and the code generator ignore it.
   */
  notes?: string;
  asynchronous: boolean;
  objects?: ObjectRef[];
  context?: ContextConfig;
  imports?: string[];
  using?: string[];
  targetLanguage?: string;
}

export interface ParameterDef {
  name: string;
  type: string;
}

export interface EventDef {
  id: string;
  name?: string;
  description?: string;
  parameters?: ParameterDef[];
  preAction?: string;
  postAction?: string;
}

export interface TimerDef {
  id: string;
  name: string;
  description?: string;
}

export interface EventSourceDef {
  name: string;
  file?: string;
  feeder?: string;
  description?: string;
  events?: EventDef[];
  timers?: TimerDef[];
}

export interface TimerStartAction {
  timer: string;
  duration: string;
}

export interface ActionDef {
  /**
   * Which of the three shapes below is meant. Optional because the engine's
   * own model omits it and real SMDF on disk does too — it is a hint the web
   * designer writes for its own property editor, not part of the contract.
   */
  action?: "code" | "timerStart" | "timerStop";
  code?: string;
  name?: string;
  timerStart?: TimerStartAction;
  timerStop?: string;
}

export interface TransitionDef {
  event: string;
  nextState?: string;
  condition?: string;
  description?: string;
  actions?: ActionDef[];
}

export type StateKindType = "normal" | "final" | "history";

export interface ParallelDef {
  nextState: string;
  states: StateDef[];
}

export interface StateDef {
  name: string;
  kind?: StateKindType;
  description?: string;
  /** Working notes about this state (see `SettingsModel.notes`). `description` says what the state IS; notes are the conversation about it. */
  notes?: string;
  onEntry?: { actions: ActionDef[] };
  onExit?: { actions: ActionDef[] };
  transitions?: TransitionDef[];
  states?: StateDef[];
  parallel?: ParallelDef;
}

export interface StateMachineDefinition {
  settings: SettingsModel;
  events: EventSourceDef[];
  state: StateDef;
}
