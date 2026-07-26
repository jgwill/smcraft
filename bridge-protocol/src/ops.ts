/**
 * The PatchOp union — the atomic vocabulary of the bridge.
 *
 * The op names mirror the MCP smcraft tools and the web store's granular
 * actions. States are unique by `name` (validation rule V002), so `name` is the
 * stable key for state-targeting ops. Events are keyed by `id`; parameters,
 * transitions, actions and event sources are addressed positionally by index.
 *
 * `runtime.*` ops are presentational (which state is currently active) and are
 * ignored by `applyPatchOps` — they never mutate the definition.
 */
import type {
  SettingsModel,
  StateDef,
  EventSourceDef,
  EventDef,
  ParameterDef,
  TransitionDef,
  ActionDef,
} from "./definition.js";

export type PatchOp =
  | { op: 'settings.update'; patch: Partial<SettingsModel> }
  | { op: 'state.add'; parent: string | null; state: StateDef; index?: number }
  | { op: 'state.update'; name: string; patch: Partial<Omit<StateDef, 'states' | 'transitions'>> }
  | { op: 'state.remove'; name: string }
  | { op: 'state.nest'; child: string; newParent: string }
  | { op: 'eventSource.add'; source: EventSourceDef; index?: number }
  | { op: 'eventSource.update'; index: number; patch: Partial<EventSourceDef> }
  | { op: 'eventSource.remove'; index: number }
  | { op: 'event.add'; sourceIndex: number; event: EventDef; index?: number }
  | { op: 'event.update'; id: string; patch: Partial<EventDef> }
  | { op: 'event.remove'; id: string }
  | { op: 'parameter.add'; eventId: string; parameter: ParameterDef; index?: number }
  | { op: 'parameter.update'; eventId: string; index: number; patch: Partial<ParameterDef> }
  | { op: 'parameter.remove'; eventId: string; index: number }
  | { op: 'transition.add'; state: string; transition: TransitionDef; index?: number }
  | { op: 'transition.update'; state: string; index: number; patch: Partial<TransitionDef> }
  | { op: 'transition.remove'; state: string; index: number }
  | { op: 'action.add'; state: string; hook: 'onEntry' | 'onExit'; action: ActionDef; index?: number }
  | { op: 'action.update'; state: string; hook: 'onEntry' | 'onExit'; index: number; action: ActionDef }
  | { op: 'action.remove'; state: string; hook: 'onEntry' | 'onExit'; index: number }
  | { op: 'runtime.enter'; state: string; from?: string; eventId?: string }
  | { op: 'runtime.exit'; state: string };
