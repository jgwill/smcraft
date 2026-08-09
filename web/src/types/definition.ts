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
  /** The generated context's class name — what `ts/src/codegen.ts` reads. */
  class?: string;
  instance?: string;
  /** The designer's own extra: a base the generated context extends. */
  baseClass?: string;
}

export interface SettingsModel {
  namespace: string;
  name?: string;
  description?: string;
  asynchronous: boolean;
  /**
   * Objects the generated context is constructed with. `ObjectRef` is what
   * `ts/src/codegen.ts` actually reads (`obj.instance`, `obj.class`); the
   * `{ name, type }` pair this field used to carry was a shape no generator
   * could consume, so an "Object References" line typed into the designer was
   * silently dropped on the way to code.
   */
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
  severity?: "error" | "warning";
}
