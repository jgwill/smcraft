import { create } from "zustand";
import type {
  StateMachineDefinition,
  StateDef,
  EventDef,
  TransitionDef,
  DesignerLayout,
  StatePosition,
  ValidationError,
  EventSourceDef,
  ActionDef,
  ParameterDef,
} from "@/types/definition";

export type SelectionKind = "state" | "transition" | "event" | null;

export interface Selection {
  kind: SelectionKind;
  id: string | null;
}

export type DrawMode = "select" | "transition";

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  target: { kind: "state" | "canvas"; id?: string } | null;
}

interface HistoryEntry {
  definition: StateMachineDefinition;
  layout: DesignerLayout;
}

interface DesignerState {
  // Definition
  definition: StateMachineDefinition;
  layout: DesignerLayout;
  fileName: string | null;
  dirty: boolean;

  // Selection
  selection: Selection;

  // Draw mode
  drawMode: DrawMode;
  drawSource: string | null;

  // Context menu
  contextMenu: ContextMenuState;

  // Undo/redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // Active panel tab in sidebar
  activeTab: "properties" | "events" | "settings";

  // Validation
  errors: ValidationError[];

  // UI
  showCodePreview: boolean;
  generatedCode: string | null;

  // Internal: push history before mutation
  _pushHistory: () => void;

  // Definition mutations
  setDefinition: (def: StateMachineDefinition) => void;
  updateSettings: (patch: Partial<StateMachineDefinition["settings"]>) => void;

  // State operations
  addState: (parentPath: string | null, state: StateDef) => void;
  updateState: (name: string, patch: Partial<StateDef>) => void;
  removeState: (name: string) => void;
  nestState: (childName: string, newParentName: string) => void;

  // Event source operations
  addEventSource: (source: EventSourceDef) => void;
  updateEventSource: (index: number, patch: Partial<EventSourceDef>) => void;
  removeEventSource: (index: number) => void;

  // Event operations
  addEvent: (evt: EventDef, sourceIndex?: number) => void;
  updateEvent: (id: string, patch: Partial<EventDef>) => void;
  removeEvent: (id: string) => void;

  // Parameter operations
  addParameter: (eventId: string, param: ParameterDef) => void;
  removeParameter: (eventId: string, paramIndex: number) => void;
  updateParameter: (eventId: string, paramIndex: number, patch: Partial<ParameterDef>) => void;

  // Action operations (onEntry/onExit)
  addAction: (stateName: string, hook: "onEntry" | "onExit", action: ActionDef) => void;
  removeAction: (stateName: string, hook: "onEntry" | "onExit", actionIndex: number) => void;
  updateAction: (stateName: string, hook: "onEntry" | "onExit", actionIndex: number, action: ActionDef) => void;

  // Transition operations
  addTransition: (stateName: string, trans: TransitionDef) => void;
  updateTransition: (stateName: string, index: number, patch: Partial<TransitionDef>) => void;
  removeTransition: (stateName: string, index: number) => void;

  // Layout
  setStatePosition: (name: string, pos: StatePosition) => void;

  // Selection
  select: (kind: SelectionKind, id: string | null) => void;
  clearSelection: () => void;

  // Draw mode
  setDrawMode: (mode: DrawMode) => void;
  setDrawSource: (name: string | null) => void;

  // Context menu
  showContextMenu: (x: number, y: number, target: ContextMenuState["target"]) => void;
  hideContextMenu: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Tab
  setActiveTab: (tab: DesignerState["activeTab"]) => void;

  // File operations
  loadFromJson: (json: string, fileName?: string) => void;
  exportJson: () => string;

  // Validation
  validate: () => ValidationError[];

  // Code generation
  setGeneratedCode: (code: string | null) => void;
  setShowCodePreview: (show: boolean) => void;
}

function createEmptyDefinition(): StateMachineDefinition {
  return {
    settings: {
      namespace: "MyApp",
      name: "MyStateMachine",
      asynchronous: false,
    },
    events: [{ name: "Internal", events: [] }],
    state: {
      name: "Root",
      states: [
        { name: "Idle", kind: "normal" },
        { name: "End", kind: "final" },
      ],
    },
  };
}

function createDefaultLayout(): DesignerLayout {
  return { positions: {} };
}

function findState(root: StateDef, name: string): StateDef | null {
  if (root.name === name) return root;
  for (const child of root.states ?? []) {
    const found = findState(child, name);
    if (found) return found;
  }
  return null;
}

function replaceState(
  root: StateDef,
  name: string,
  updater: (s: StateDef) => StateDef | null
): StateDef {
  if (root.name === name) {
    const result = updater(root);
    return result ?? root;
  }
  return {
    ...root,
    states: root.states?.map((s) => replaceState(s, name, updater)),
  };
}

function removeStateFromTree(root: StateDef, name: string): StateDef {
  return {
    ...root,
    states: root.states
      ?.filter((s) => s.name !== name)
      .map((s) => removeStateFromTree(s, name)),
  };
}

export function collectStateNames(root: StateDef): string[] {
  const names = [root.name];
  for (const child of root.states ?? []) {
    names.push(...collectStateNames(child));
  }
  return names;
}

export function collectAllStates(root: StateDef): StateDef[] {
  const states = [root];
  for (const child of root.states ?? []) {
    states.push(...collectAllStates(child));
  }
  return states;
}

export function collectEventIds(def: StateMachineDefinition): string[] {
  return def.events.flatMap((source) =>
    (source.events ?? []).map((e) => e.id)
  );
}

function validateDefinition(def: StateMachineDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const stateNames = collectStateNames(def.state);
  const eventIds = collectEventIds(def);

  if (eventIds.length === 0) {
    errors.push({ ruleId: "V001", message: "No events defined" });
  }

  const seen = new Set<string>();
  for (const name of stateNames) {
    if (seen.has(name)) {
      errors.push({ ruleId: "V002", message: `Duplicate state name: ${name}`, element: name });
    }
    seen.add(name);
  }

  function checkTransitions(state: StateDef) {
    for (const t of state.transitions ?? []) {
      if (!eventIds.includes(t.event)) {
        errors.push({ ruleId: "V003", message: `Transition in '${state.name}' references unknown event '${t.event}'`, element: state.name });
      }
      if (t.nextState && !stateNames.includes(t.nextState)) {
        errors.push({ ruleId: "V004", message: `Transition in '${state.name}' targets unknown state '${t.nextState}'`, element: state.name });
      }
    }
    if (state.kind === "final" && (state.transitions?.length ?? 0) > 0) {
      errors.push({ ruleId: "V007", message: `Final state '${state.name}' must not have outgoing transitions`, element: state.name });
    }
    if (state.kind === "final" && (state.states?.length ?? 0) > 0) {
      errors.push({ ruleId: "V008", message: `Final state '${state.name}' must not have child states`, element: state.name });
    }
    for (const child of state.states ?? []) {
      checkTransitions(child);
    }
  }
  checkTransitions(def.state);

  if (!def.state.states || def.state.states.length === 0) {
    errors.push({ ruleId: "V005", message: "Root state must have at least one child state", element: def.state.name });
  }

  // V003 duplicate event IDs
  const eventSeen = new Set<string>();
  for (const id of eventIds) {
    if (eventSeen.has(id)) {
      errors.push({ ruleId: "V003", message: `Duplicate event ID: ${id}`, element: id });
    }
    eventSeen.add(id);
  }

  return errors;
}

function autoLayout(def: StateMachineDefinition, existing: DesignerLayout): DesignerLayout {
  const positions = { ...existing.positions };

  function layoutChildren(parent: StateDef, offsetX: number, offsetY: number) {
    const children = parent.states ?? [];
    children.forEach((s, i) => {
      if (!positions[s.name]) {
        const hasChildren = (s.states?.length ?? 0) > 0;
        positions[s.name] = {
          x: offsetX + i * 220,
          y: offsetY,
          width: hasChildren ? 300 : 160,
          height: hasChildren ? 200 : 60,
        };
      }
      if (s.states && s.states.length > 0) {
        const p = positions[s.name];
        layoutChildren(s, p.x + 20, p.y + 40);
      }
    });
  }

  layoutChildren(def.state, 100, 120);

  if (!positions[def.state.name]) {
    const children = def.state.states ?? [];
    positions[def.state.name] = {
      x: 20, y: 20,
      width: Math.max(children.length * 220 + 80, 400),
      height: 350,
    };
  }
  return { positions };
}

const MAX_UNDO = 50;

export const useDesignerStore = create<DesignerState>((set, get) => ({
  definition: createEmptyDefinition(),
  layout: autoLayout(createEmptyDefinition(), createDefaultLayout()),
  fileName: null,
  dirty: false,
  selection: { kind: null, id: null },
  drawMode: "select",
  drawSource: null,
  contextMenu: { visible: false, x: 0, y: 0, target: null },
  undoStack: [],
  redoStack: [],
  activeTab: "properties",
  errors: [],
  showCodePreview: false,
  generatedCode: null,

  _pushHistory: () => {
    const { definition, layout, undoStack } = get();
    const entry: HistoryEntry = {
      definition: JSON.parse(JSON.stringify(definition)),
      layout: JSON.parse(JSON.stringify(layout)),
    };
    set({
      undoStack: [...undoStack.slice(-MAX_UNDO), entry],
      redoStack: [],
    });
  },

  setDefinition: (def) => {
    get()._pushHistory();
    const layout = autoLayout(def, get().layout);
    set({ definition: def, layout, dirty: true, errors: validateDefinition(def) });
  },

  updateSettings: (patch) => {
    get()._pushHistory();
    const def = { ...get().definition, settings: { ...get().definition.settings, ...patch } };
    set({ definition: def, dirty: true });
  },

  addState: (parentPath, state) => {
    get()._pushHistory();
    const def = { ...get().definition };
    const parentName = parentPath ?? def.state.name;
    def.state = replaceState(def.state, parentName, (p) => ({
      ...p,
      states: [...(p.states ?? []), state],
    }));
    const layout = autoLayout(def, get().layout);
    set({ definition: def, layout, dirty: true, errors: validateDefinition(def) });
  },

  updateState: (name, patch) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, name, (s) => ({ ...s, ...patch }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  removeState: (name) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = removeStateFromTree(def.state, name);
    const layout = { positions: { ...get().layout.positions } };
    delete layout.positions[name];
    set({ definition: def, layout, dirty: true, errors: validateDefinition(def) });
  },

  nestState: (childName, newParentName) => {
    get()._pushHistory();
    const def = { ...get().definition };
    const child = findState(def.state, childName);
    if (!child || childName === newParentName) return;
    const childCopy = JSON.parse(JSON.stringify(child));
    def.state = removeStateFromTree(def.state, childName);
    def.state = replaceState(def.state, newParentName, (p) => ({
      ...p,
      states: [...(p.states ?? []), childCopy],
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  addEventSource: (source) => {
    get()._pushHistory();
    const def = { ...get().definition, events: [...get().definition.events, source] };
    set({ definition: def, dirty: true });
  },

  updateEventSource: (index, patch) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.map((s, i) => (i === index ? { ...s, ...patch } : s));
    set({ definition: def, dirty: true });
  },

  removeEventSource: (index) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.filter((_, i) => i !== index);
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  addEvent: (evt, sourceIndex = 0) => {
    get()._pushHistory();
    const def = { ...get().definition };
    const source = def.events[sourceIndex] ?? { name: "Internal", events: [] };
    source.events = [...(source.events ?? []), evt];
    def.events = def.events.map((s, i) => (i === sourceIndex ? source : s));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  updateEvent: (id, patch) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
    set({ definition: def, dirty: true });
  },

  removeEvent: (id) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.filter((e) => e.id !== id),
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  addParameter: (eventId, param) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.map((e) =>
        e.id === eventId ? { ...e, parameters: [...(e.parameters ?? []), param] } : e
      ),
    }));
    set({ definition: def, dirty: true });
  },

  removeParameter: (eventId, paramIndex) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.map((e) =>
        e.id === eventId ? { ...e, parameters: e.parameters?.filter((_, i) => i !== paramIndex) } : e
      ),
    }));
    set({ definition: def, dirty: true });
  },

  updateParameter: (eventId, paramIndex, patch) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.map((e) =>
        e.id === eventId
          ? { ...e, parameters: e.parameters?.map((p, i) => (i === paramIndex ? { ...p, ...patch } : p)) }
          : e
      ),
    }));
    set({ definition: def, dirty: true });
  },

  addAction: (stateName, hook, action) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => {
      const hookData = s[hook] ?? { actions: [] };
      return { ...s, [hook]: { actions: [...hookData.actions, action] } };
    });
    set({ definition: def, dirty: true });
  },

  removeAction: (stateName, hook, actionIndex) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => {
      const hookData = s[hook];
      if (!hookData) return s;
      return { ...s, [hook]: { actions: hookData.actions.filter((_, i) => i !== actionIndex) } };
    });
    set({ definition: def, dirty: true });
  },

  updateAction: (stateName, hook, actionIndex, action) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => {
      const hookData = s[hook];
      if (!hookData) return s;
      return { ...s, [hook]: { actions: hookData.actions.map((a, i) => (i === actionIndex ? action : a)) } };
    });
    set({ definition: def, dirty: true });
  },

  addTransition: (stateName, trans) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => ({
      ...s,
      transitions: [...(s.transitions ?? []), trans],
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  updateTransition: (stateName, index, patch) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => ({
      ...s,
      transitions: s.transitions?.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
    set({ definition: def, dirty: true });
  },

  removeTransition: (stateName, index) => {
    get()._pushHistory();
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => ({
      ...s,
      transitions: s.transitions?.filter((_, i) => i !== index),
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  setStatePosition: (name, pos) => {
    set({ layout: { positions: { ...get().layout.positions, [name]: pos } } });
  },

  select: (kind, id) => set({ selection: { kind, id } }),
  clearSelection: () => set({ selection: { kind: null, id: null } }),

  setDrawMode: (mode) => set({ drawMode: mode, drawSource: null }),
  setDrawSource: (name) => set({ drawSource: name }),

  showContextMenu: (x, y, target) => set({ contextMenu: { visible: true, x, y, target } }),
  hideContextMenu: () => set({ contextMenu: { visible: false, x: 0, y: 0, target: null } }),

  undo: () => {
    const { undoStack, definition, layout } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const current: HistoryEntry = {
      definition: JSON.parse(JSON.stringify(definition)),
      layout: JSON.parse(JSON.stringify(layout)),
    };
    set({
      definition: prev.definition,
      layout: prev.layout,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, current],
      dirty: true,
      errors: validateDefinition(prev.definition),
    });
  },

  redo: () => {
    const { redoStack, definition, layout } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const current: HistoryEntry = {
      definition: JSON.parse(JSON.stringify(definition)),
      layout: JSON.parse(JSON.stringify(layout)),
    };
    set({
      definition: next.definition,
      layout: next.layout,
      undoStack: [...get().undoStack, current],
      redoStack: redoStack.slice(0, -1),
      dirty: true,
      errors: validateDefinition(next.definition),
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadFromJson: (json, fileName) => {
    try {
      const parsed = JSON.parse(json);
      const def: StateMachineDefinition = parsed.stateMachine ?? parsed.StateMachine ?? parsed;
      const layout = autoLayout(def, createDefaultLayout());
      set({
        definition: def,
        layout,
        fileName: fileName ?? null,
        dirty: false,
        errors: validateDefinition(def),
        selection: { kind: null, id: null },
        undoStack: [],
        redoStack: [],
      });
    } catch (e) {
      console.error("Failed to parse definition:", e);
    }
  },

  exportJson: () => {
    const { definition } = get();
    return JSON.stringify({ stateMachine: definition }, null, 2);
  },

  validate: () => {
    const errors = validateDefinition(get().definition);
    set({ errors });
    return errors;
  },

  setGeneratedCode: (code) => set({ generatedCode: code }),
  setShowCodePreview: (show) => set({ showCodePreview: show }),
}));
