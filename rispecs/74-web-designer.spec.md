# Web Designer — Visual State Machine Editor

> RISE Framework Specification
> References: CAISHEN Spec 63 (State Machine Designer), smcraft/MMOT.md

**Spec ID**: 74
**Version**: 1.0
**Source**: Extracted from `smcraft/web/src/`
**Implementation**: Next.js + React + Zustand + SVG (`web/src/`)

## Creative Intent

**What the Web Designer Enables Users to Create:**
A visual, interactive environment where humans and LLM agents design hierarchical state machines — placing states on a canvas, wiring transitions, managing events, validating structure — and generating executable code directly from the design.

**Desired Outcomes:**
1. User drags states onto canvas, draws transitions between them, validates, and generates code — all visually
2. Composite states support drill-down navigation — click to enter sub-diagram, breadcrumb to return
3. Parallel regions render as side-by-side containers within a parent state
4. "Generate" button produces real executable code (not just JSON export)
5. Design is accessible both to human point-and-click and LLM MCP tool manipulation

## Component Architecture

### Canvas (`Canvas.tsx`)
SVG-based rendering surface for state nodes and transition arrows.

**Current Behavior:**
- `collectAllStates(definition.state)` flattens hierarchy into flat list
- Renders leaf states as rounded rectangles with labels
- Transitions rendered as Bézier curves between state centers
- Draw mode: click source → click target → event picker popup
- Drag-to-move with position persistence in store
- Context menu (right-click) for state operations
- Error highlighting (red borders, ⚠ icon for validation errors)
- Keyboard: Delete (remove), Ctrl+Z/Y (undo/redo), Escape (deselect)

**Visual State Indicators:**
- Final states: dashed border
- History states: rounded border
- Composite states: dashed border (currently same as final — needs distinction)
- Entry actions: green `▸entry` badge
- Exit actions: orange `exit◂` badge

### Toolbar (`Toolbar.tsx`)
Control bar with file operations and workflow actions.

**Actions:**
- File: Open (.smdf.json), Save, Export JSON
- Mode: Select ↔ Transition draw mode toggle
- State: +State (inline name input), Delete
- Workflow: Validate, Generate
- Edit: Undo, Redo

### PropertiesPanel (`PropertiesPanel.tsx`)
Edit panel for selected state or transition.

**Fields:**
- State name, kind (leaf/composite/final/history/parallel), description
- onEntry/onExit actions (add/edit/remove action list)

### EventsPanel (`EventsPanel.tsx`)
Event source and parameter management.

**Behavior:**
- List event sources with their events
- Add/remove/edit events
- Manage parameters per event (name, type)
- Inline editing with sortable table

### SettingsPanel (`SettingsPanel.tsx`)
Machine-level configuration.

**Fields:** namespace, name, asynchronous flag

### CodePreview (`CodePreview.tsx`)
Modal showing generated output.

**Current**: Shows JSON definition (not generated code)
**Desired**: Shows actual Python/TypeScript generated code with language selection

### ValidationPanel (`ValidationPanel.tsx`)
Real-time validation error display.

**Behavior:**
- Lists all validation errors with rule ID and element context
- Clickable: selects the erroring state on canvas
- Updates on every definition change

## State Management (`useDesignerStore.ts`)

### Zustand Store Structure
```typescript
interface DesignerStore {
  definition: StateMachineDefinition;
  selectedState: string | null;
  selectedTransition: TransitionRef | null;
  mode: 'select' | 'transition';
  positions: Record<string, { x: number; y: number }>;
  dirty: boolean;
  undoStack: Definition[];  // max 50
  redoStack: Definition[];

  // MMOT Addition — Composite Drill-Down
  navigationPath: string[];  // breadcrumb: ["Root", "Composite1", "SubComposite"]
  currentParent: string;     // which state's children are currently displayed
}
```

### Key Methods
- `addState(name, parent)` — Create state with undo history
- `removeState(name)` — Remove state + referencing transitions
- `addTransition(from, event, to, condition?, action?)` — Wire transition
- `validateDefinition()` — Run V001-V013 inline
- `collectAllStates(state)` — Recursive DFS → flat array
- `autoLayout()` — Hierarchical position calculation

## Structural Tensions (MMOT Critical Items)

### 1. Composite State Drill-Down (CRITICAL)
**Current Reality**: `collectAllStates()` flattens entire hierarchy; Canvas renders all states at same level; no visual nesting or navigation
**Desired Outcome**: Click composite state → canvas shows only its children; breadcrumb navigation back to parent; visual hint that you're "inside" a composite state

**Design:**
```
┌─ Root > OrderProcessing > PaymentFlow ──────────┐
│                                                   │
│   ┌──────────┐    EvPay    ┌────────────┐        │
│   │ Pending  │────────────→│ Processing │        │
│   └──────────┘             └────────────┘        │
│                     EvFail       │ EvSuccess      │
│               ┌──────────┐      ▼                │
│               │  Failed  │  ┌──────────┐         │
│               └──────────┘  │ Complete │         │
│                             └──────────┘         │
└───────────────────────────────────────────────────┘
```

**Implementation Path:**
1. Add `navigationPath: string[]` to store (default `["Root"]`)
2. Add `navigateInto(stateName)` and `navigateUp()` actions
3. Modify Canvas to render only `currentParent.states` (not `collectAllStates()`)
4. Add breadcrumb component above canvas
5. Double-click composite state → `navigateInto()`
6. Breadcrumb click → `navigateUp()` to that level

### 2. Generate Button → Real Codegen (CRITICAL)
**Current Reality**: `handleGenerate()` calls `exportJson()` — shows JSON definition, not executable code
**Desired Outcome**: Generate button invokes real code generation, shows Python/TypeScript output

**Design:**
```
Toolbar "Generate" click
  → POST /api/generate { definition, language }
  → Server: write temp .smdf.json → exec `smcg` → read output
  → Return generated code string
  → CodePreview shows real Python/TypeScript
```

**Fallback (no server):** Write definition to file, exec `smcg` via Electron/WASM, read result

### 3. Parallel Region Rendering
**Current Reality**: Parallel states shown as regular states with dashed border
**Desired Outcome**: Parallel states render as split container with regions side-by-side

**Design:**
```
┌─ ParallelState ──────────────────────────────┐
│ ┌─ Region1 ─────────┐ ┌─ Region2 ─────────┐ │
│ │ StateA → StateB    │ │ StateC → StateD    │ │
│ └────────────────────┘ └────────────────────┘ │
└──────────────────────────────────────────────┘
```

## Creative Advancement Scenarios

### Scenario: Designing a Creative Process State Machine
**Desired Outcome**: mia-code-server creative process stages (Germination → Assimilation → Completion) designed as a visual state machine with composite states for each phase
**Current Reality**: Web designer renders all states flat — no drill-down into Germination's sub-states (TaskDefinition, SpecGeneration, PDEDecomposition)
**Natural Progression**: User loads `creative-process.smdf.json` → sees top-level states → double-clicks "Germination" → canvas shows sub-states → designs internal transitions → navigates back → exports complete hierarchical SMDF
**Resolution**: Full composite state machine designed visually with drill-down navigation

### Scenario: iPad-Friendly Trading Workflow Design
**Desired Outcome**: Trader designs FDB Breakout Strategy FSM on iPad via touch interface
**Current Reality**: SVG canvas works but lacks touch optimization
**Natural Progression**: Responsive canvas + touch event handlers → pinch-zoom, tap-to-select, long-press context menu
**Resolution**: Mobile-friendly state machine designer

## Dependencies

- **Spec 70 (SMDF)**: Data model rendered and edited by the designer
- **Spec 72 (Code Generator)**: Generate button invokes codegen
- **Spec 73 (MCP Server)**: Shares same definition model; MCP tools can manipulate what's being designed
