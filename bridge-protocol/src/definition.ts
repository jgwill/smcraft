/**
 * Canonical SMDF definition types owned by the bridge protocol.
 *
 * The protocol keeps its own dependency-free copy so downstream packages can
 * import it without pulling in `web` or `ts`. It mirrors
 * `web/src/types/definition.ts` (the subset relevant to the wire protocol).
 */

export interface SettingsModel {
  namespace: string;
  name?: string;
  description?: string;
  asynchronous: boolean;
  objects?: { name: string; type: string }[];
  context?: { className?: string; baseClass?: string };
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
  action: "code" | "timerStart" | "timerStop";
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
