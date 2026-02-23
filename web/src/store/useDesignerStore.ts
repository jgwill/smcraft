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
} from "@/types/definition";

type SelectionKind = "state" | "transition" | "event" | null;

interface Selection {
  kind: SelectionKind;
  id: string | null;
}

interface DesignerState {
  // Definition
  definition: StateMachineDefinition;
  layout: DesignerLayout;
  fileName: string | null;
  dirty: boolean;

  // Selection
  selection: Selection;

  // Validation
  errors: ValidationError[];

  // UI
  showCodePreview: boolean;
  generatedCode: string | null;

  // Definition mutations
  setDefinition: (def: StateMachineDefinition) => void;
  updateSettings: (patch: Partial<StateMachineDefinition["settings"]>) => void;

  // State operations
  addState: (parentPath: string | null, state: StateDef) => void;
  updateState: (name: string, patch: Partial<StateDef>) => void;
  removeState: (name: string) => void;

  // Event operations
  addEvent: (evt: EventDef) => void;
  updateEvent: (id: string, patch: Partial<EventDef>) => void;
  removeEvent: (id: string) => void;

  // Transition operations
  addTransition: (stateName: string, trans: TransitionDef) => void;
  updateTransition: (
    stateName: string,
    index: number,
    patch: Partial<TransitionDef>
  ) => void;
  removeTransition: (stateName: string, index: number) => void;

  // Layout
  setStatePosition: (name: string, pos: StatePosition) => void;

  // Selection
  select: (kind: SelectionKind, id: string | null) => void;
  clearSelection: () => void;

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

/** Recursively find a state by name in the tree */
function findState(root: StateDef, name: string): StateDef | null {
  if (root.name === name) return root;
  for (const child of root.states ?? []) {
    const found = findState(child, name);
    if (found) return found;
  }
  return null;
}

/** Recursively replace a state by name */
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

/** Remove a state by name from tree */
function removeStateFromTree(root: StateDef, name: string): StateDef {
  return {
    ...root,
    states: root.states
      ?.filter((s) => s.name !== name)
      .map((s) => removeStateFromTree(s, name)),
  };
}

/** Collect all state names from tree */
function collectStateNames(root: StateDef): string[] {
  const names = [root.name];
  for (const child of root.states ?? []) {
    names.push(...collectStateNames(child));
  }
  return names;
}

/** Collect all event IDs */
function collectEventIds(def: StateMachineDefinition): string[] {
  return def.events.flatMap((source) =>
    (source.events ?? []).map((e) => e.id)
  );
}

/** Basic validation */
function validateDefinition(def: StateMachineDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const stateNames = collectStateNames(def.state);
  const eventIds = collectEventIds(def);

  // V001: At least one event
  if (eventIds.length === 0) {
    errors.push({ ruleId: "V001", message: "No events defined" });
  }

  // V002: Duplicate state names
  const seen = new Set<string>();
  for (const name of stateNames) {
    if (seen.has(name)) {
      errors.push({
        ruleId: "V002",
        message: `Duplicate state name: ${name}`,
        element: name,
      });
    }
    seen.add(name);
  }

  // V003: Transitions reference valid events
  function checkTransitions(state: StateDef) {
    for (const t of state.transitions ?? []) {
      if (!eventIds.includes(t.event)) {
        errors.push({
          ruleId: "V003",
          message: `Transition in '${state.name}' references unknown event '${t.event}'`,
          element: state.name,
        });
      }
      if (t.nextState && !stateNames.includes(t.nextState)) {
        errors.push({
          ruleId: "V004",
          message: `Transition in '${state.name}' targets unknown state '${t.nextState}'`,
          element: state.name,
        });
      }
    }
    for (const child of state.states ?? []) {
      checkTransitions(child);
    }
  }
  checkTransitions(def.state);

  // V005: Root must have children
  if (!def.state.states || def.state.states.length === 0) {
    errors.push({
      ruleId: "V005",
      message: "Root state must have at least one child state",
      element: def.state.name,
    });
  }

  return errors;
}

/** Auto-layout states that don't have positions */
function autoLayout(
  def: StateMachineDefinition,
  existing: DesignerLayout
): DesignerLayout {
  const positions = { ...existing.positions };
  const states = def.state.states ?? [];
  states.forEach((s, i) => {
    if (!positions[s.name]) {
      positions[s.name] = {
        x: 100 + i * 220,
        y: 150,
        width: 160,
        height: 60,
      };
    }
  });
  if (!positions[def.state.name]) {
    positions[def.state.name] = {
      x: 20,
      y: 20,
      width: states.length * 220 + 80,
      height: 300,
    };
  }
  return { positions };
}

export const useDesignerStore = create<DesignerState>((set, get) => ({
  definition: createEmptyDefinition(),
  layout: autoLayout(createEmptyDefinition(), createDefaultLayout()),
  fileName: null,
  dirty: false,
  selection: { kind: null, id: null },
  errors: [],
  showCodePreview: false,
  generatedCode: null,

  setDefinition: (def) => {
    const layout = autoLayout(def, get().layout);
    set({ definition: def, layout, dirty: true, errors: validateDefinition(def) });
  },

  updateSettings: (patch) => {
    const def = {
      ...get().definition,
      settings: { ...get().definition.settings, ...patch },
    };
    set({ definition: def, dirty: true });
  },

  addState: (parentPath, state) => {
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
    const def = { ...get().definition };
    def.state = replaceState(def.state, name, (s) => ({ ...s, ...patch }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  removeState: (name) => {
    const def = { ...get().definition };
    def.state = removeStateFromTree(def.state, name);
    const layout = { positions: { ...get().layout.positions } };
    delete layout.positions[name];
    set({ definition: def, layout, dirty: true, errors: validateDefinition(def) });
  },

  addEvent: (evt) => {
    const def = { ...get().definition };
    const source = def.events[0] ?? { name: "Internal", events: [] };
    source.events = [...(source.events ?? []), evt];
    def.events = [source, ...def.events.slice(1)];
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  updateEvent: (id, patch) => {
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    }));
    set({ definition: def, dirty: true });
  },

  removeEvent: (id) => {
    const def = { ...get().definition };
    def.events = def.events.map((source) => ({
      ...source,
      events: source.events?.filter((e) => e.id !== id),
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  addTransition: (stateName, trans) => {
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => ({
      ...s,
      transitions: [...(s.transitions ?? []), trans],
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  updateTransition: (stateName, index, patch) => {
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => ({
      ...s,
      transitions: s.transitions?.map((t, i) =>
        i === index ? { ...t, ...patch } : t
      ),
    }));
    set({ definition: def, dirty: true });
  },

  removeTransition: (stateName, index) => {
    const def = { ...get().definition };
    def.state = replaceState(def.state, stateName, (s) => ({
      ...s,
      transitions: s.transitions?.filter((_, i) => i !== index),
    }));
    set({ definition: def, dirty: true, errors: validateDefinition(def) });
  },

  setStatePosition: (name, pos) => {
    set({
      layout: {
        positions: { ...get().layout.positions, [name]: pos },
      },
    });
  },

  select: (kind, id) => set({ selection: { kind, id } }),
  clearSelection: () => set({ selection: { kind: null, id: null } }),

  loadFromJson: (json, fileName) => {
    try {
      const parsed = JSON.parse(json);
      const def: StateMachineDefinition =
        parsed.stateMachine ?? parsed.StateMachine ?? parsed;
      const layout = autoLayout(def, createDefaultLayout());
      set({
        definition: def,
        layout,
        fileName: fileName ?? null,
        dirty: false,
        errors: validateDefinition(def),
        selection: { kind: null, id: null },
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
