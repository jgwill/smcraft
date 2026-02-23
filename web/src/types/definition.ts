/**
 * State Machine Definition types (mirrors smcraft/ts model)
 * Used by the web designer to edit definitions.
 */

export interface ObjectRef {
  instance: string;
  class: string;
  namespace?: string;
}

export interface ContextConfig {
  class?: string;
  instance?: string;
}

export interface SettingsModel {
  namespace: string;
  name?: string;
  asynchronous: boolean;
  objects?: ObjectRef[];
  context?: ContextConfig;
  using?: string[];
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
  code?: string;
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

// Visual layout data (not part of .smdf.json — stored in .smdp.json)
export interface StatePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignerLayout {
  positions: Record<string, StatePosition>;
}

export interface ValidationError {
  ruleId: string;
  message: string;
  element?: string;
}
