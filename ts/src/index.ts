/**
 * State Machine Framework — Barrel Exports
 *
 * Implements Specs 60, 61, 62 for TypeScript.
 */

// Model (Spec 60)
export type {
  StateMachineDefinition,
  StateDef,
  EventDef,
  EventSourceDef,
  TimerDef,
  TransitionDef,
  ActionDef,
  ParallelDef,
  ParameterDef,
  ObjectRef,
  ContextConfig,
  SettingsModel,
  StateKindType,
} from "./model.js";

// Parser (Spec 60)
export {
  parseJson,
  parseFile,
  enrich,
  validate,
} from "./parser.js";
export type { ValidationError, EnrichedModel } from "./parser.js";

// Runtime (Spec 61)
export {
  ContextBase,
  Context,
  ContextAsync,
  State,
  StateKind,
  TransitionHelper,
  ObserverNull,
  ObserverConsole,
} from "./runtime.js";
export type { IObserver, EndHandler } from "./runtime.js";

// Code Generator (Spec 62)
export { TypeScriptCodeGenerator } from "./codegen.js";
