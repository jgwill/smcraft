# Web Designer — Visual State Machine Editor

> RISE Framework Specification
> References: CAISHEN Spec 63 (State Machine Designer), smcraft/MMOT.md

**Spec ID**: 74
**Version**: 2.0
**Source**: Extracted from `web/src/`, `bridge-canvas/src/`
**Implementation**: Next.js 16 (App Router) + React 19 + Zustand 5 + Tailwind 4 + SVG. Source `web/` stays `"private": true`; its prebuilt standalone build ships as `@miadi/stateloom-web` (bin `stateloom-web`, port 4598). The board itself is `@miadi/stateloom-canvas`
**Revised**: 2026-09-20 (v2.0) — the three v1.0 tensions all resolved; the canvas left the app and became a package; the designer gained a live socket, document switching, an ERD workspace and a phone layout

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

### The board is a package, not a file

`Canvas.tsx` is ~120 lines of binding. Every pixel — gesture bookkeeping, edge routing, chip settling, touch heuristics — moved to `@miadi/stateloom-canvas` as `<StateMachineCanvas>`: props in, callbacks out, store-blind, every colour a `--slc-*` CSS variable. `Canvas.tsx` says which store field answers which prop and nothing else.

This happened because forgewright wanted the same board and could not have it while the board and the store were one object. Anything that improves in the package now reaches both applications at once. The package ships `@miadi/stateloom-canvas/styles.css` beside it.

**Board behaviour** (in the package):
- Wheel to pan, ⌃wheel to zoom, middle-drag, Space+drag, pinch on touch
- Composite drill-down — double-click to enter, breadcrumb to walk back
- Box dragging, with the drag ownership arbitrated by `gestureOwner` so a pinch is never mistaken for a move
- Edges routed through assigned ports, so two edges between the same pair each get their own door
- Settled event chips, a zoom HUD, live-state pulses from `runtime.enter` / `runtime.exit`
- Error highlighting (red borders, ⚠ icon), keyboard: Delete, Ctrl+Z / Ctrl+Y, Escape

**Visual State Indicators:**
- Final states: dashed border
- History states: rounded border
- Composite states: dashed border (still the same as final — the one v1.0 distinction not yet drawn)
- Entry actions: green `▸entry` badge
- Exit actions: orange `exit◂` badge

### `<EntityRelationshipCanvas>`
The second surface in the same package — an ERD in crow's foot or Chen notation, chosen by the viewer and never written to the file. See Spec 80.

### Toolbar (`Toolbar.tsx`)
Control bar with file operations and workflow actions.

**Actions:**
- File: Open (.smdf.json), Save to disk (`PUT /api/file`), 📥 Export
- Mode: Select ↔ Transition draw mode toggle
- State: +State (inline name input), Delete
- Workflow: Validate, Generate, 📜 RISE (Spec 76)
- Edit: Undo, Redo
- Layout: ⤢ Arrange

**Export formats** (`lib/exportImage.ts`): `png`, `jpeg`, `svg`, `mermaid`, `markdown`. The three picture formats take the canvas as it stands, hand-dragged boxes included; `mermaid` and `markdown` come from the definition, since a mermaid graph has no placement to carry. Every download is named `[ep252--]<Machine>--<yyMMddHHmmss>.<ext>` by the protocol's `exportName`, so the browser, the CLI and the MCP agree on file names.

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
Modal showing generated output — real generated source, from `POST /api/generate` running `smcg`. Python works; TypeScript reaches `smcg -l typescript` and is rejected (Spec 72).

### Document plumbing
| File | Carries |
|---|---|
| `lib/docParam.ts` | `?doc=<path>` — the requested document, passed through to the server, never resolved in the browser |
| `lib/projectFile.ts` | Server-side resolution and the root allowlist |
| `lib/runtimeConfig.ts` | `GET /api/config` for the bridge URL, so a *prebuilt* designer carries nobody's URL and a redeploy is a restart, not a rebuild. The build-time `NEXT_PUBLIC_*` value remains the fallback for a copy built from source |
| `lib/layoutMemory.ts` | Hand-dragged box positions in `localStorage`, keyed by resolved path, storing only what deviates from `autoLayout` — so ⤢ Arrange writes nothing and a renamed state prunes itself |
| `lib/exportImage.ts` | The five export formats and their names |
| `lib/uiScale.ts`, `lib/gestureOwner.ts`, `lib/useSheetDrag.ts` | UI scale, which element owns a pinch, and the bottom sheet whose handle drags |
| `DocSwitcher.tsx` | The picker over `GET /api/docs` |

### Bridge providers
`BridgeProvider.tsx` is the file + SSE layer (Spec 75). `SocketBridgeProvider.tsx` and `DesignBridge.tsx` are the socket.io layer (Spec 77) — granular `PatchOp`s, sequence numbers, resync, and `PresenceChips.tsx` showing who else is on the board.

### ERD workspace (`components/erd/ErdWorkspace.tsx`)
A document ending in `.erdf.json` opens a different workspace, decided before either designer mounts. It shares the file API, the hub room keyed by the resolved path and the canvas package; it shares none of the store, because an ERD has no state tree, no events and no PatchOps. Every edit is written to disk and then pushed whole, because the agent's MCP tools read the file before each of their own edits.

Its own furniture, which the state-machine board does not have: a ▤ / ◇ notation switch in a header that stays one row at every width; zoom, fit and a **padlock** floating on the board (`LockIcon.tsx` — locked, a drag on a shape pans instead of moving it, and that is the default on a touch screen); a status line over the board's corner; and at phone width a bottom sheet behind a four-tab dock (Entities, Relations, Notes, Issues) whose handle drags — down to close, up to grow, a tap to toggle (`lib/useSheetDrag.ts`). See Spec 80.

### ValidationPanel (`ValidationPanel.tsx`)
Real-time validation error display.

**Behavior:**
- Lists all validation errors with rule ID and element context
- Clickable: selects the erroring state on canvas
- Updates on every definition change

## State Management (`useDesignerStore.ts`)

### Zustand Store Structure
```typescript
interface DesignerState {
  definition: StateMachineDefinition;
  layout: DesignerLayout;          // positions + viewport
  docPath: string | null;          // the resolved document this board is showing
  dirty: boolean;
  selection: Selection;            // { kind, id }
  drawMode: DrawMode; drawSource: string | null;
  contextMenu: ContextMenuState;
  undoStack: HistoryEntry[];       // definition + layout together
  redoStack: HistoryEntry[];
  activeTab: "properties" | "events" | "settings";
  errors: ValidationError[];

  // File + SSE layer (Spec 75)
  remoteMtime: number | null;
  remoteStatus: "idle" | "synced" | "remote-changed" | "error";

  // Live bridge (Spec 77)
  activeStates: string[];          // what a running Machine is in
  presence: Presence[];

  // Composite drill-down (v1.0 tension 1 — landed)
  navigationPath: string[];        // breadcrumb: ["Root", "Composite1"]
  currentParent: string;
}
```

### Key Methods
- `addState(parentPath, state)` / `updateState` / `removeState` / `nestState` — hierarchy edits with undo history
- `addEvent` / `addParameter` / `addAction` / `addTransition` and their update/remove twins
- `setStatePosition`, `arrangeLayout`, `hydrateLayout`, `setViewport` — the layout half of a history entry
- `validate()` — run the rules and fill `errors`
- `applyRemote(json, mtime)` — whole-file remote change (Spec 75)
- `applyRemoteOps(ops, mtime, seq)` — granular remote patches (Spec 77)
- `enterState` / `exitState` / `setPresence` — live runtime and presence
- `navigateInto(name)` / `navigateUp(level?)` / `getCurrentChildren()` — drill-down
- `collectAllStates(root)`, `collectStateNames(root)`, `collectEventIds(def)` — pure helpers

## Structural Tensions (MMOT Critical Items)

All three v1.0 items resolved. They are kept, struck through, because the design each one reached for is the design that shipped.

### 1. Composite State Drill-Down — **resolved**
~~**Current Reality**: `collectAllStates()` flattens entire hierarchy~~ — `getCurrentChildren()` renders `currentParent.states`, `navigateInto` / `navigateUp` walk the tree, and the breadcrumb sits above the canvas. Double-click enters; the drill state lives in `bridge-canvas/src/drill.ts` so forgewright gets it too
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

**Implementation Path (all landed):**
1. ✅ `navigationPath: string[]` in the store (default `["Root"]`)
2. ✅ `navigateInto(stateName)` and `navigateUp(toLevel?)` actions
3. ✅ Canvas renders only `currentParent.states`
4. ✅ Breadcrumb component above canvas
5. ✅ Double-click composite state → `navigateInto()`
6. ✅ Breadcrumb click → `navigateUp()` to that level

### 2. Generate Button → Real Codegen — **resolved for Python**
~~**Current Reality**: `handleGenerate()` calls `exportJson()`~~ — `POST /api/generate` writes a temp `.smdf.json`, runs `smcg` with `execFileSync` (no shell; the machine name is sanitized because it comes from the request body), reads `{snake}_fsm.py` back and returns it into `CodePreview`. The TypeScript path is written but reaches an `smcg` that only accepts `-l python` — Spec 72 holds that remainder
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

### 3. Parallel Region Rendering — **open**
**Current Reality**: Parallel states shown as regular states with dashed border. The engines do not execute parallel regions either (Spec 71), so this is one hole with two faces — drawing it before it runs would be drawing a promise
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

### Scenario: iPad-Friendly Trading Workflow Design — **resolved**
**Desired Outcome**: Trader designs an FSM on a tablet or a phone via touch
**Current Reality**: ~~SVG canvas lacks touch optimization~~ — pinch-zoom, tap-to-select and held-press context menu ship in `@miadi/stateloom-canvas`, with `gestureOwner` deciding which element owns a pinch. The ERD workspace goes further, and the phone-first work landed there first: a dragging bottom sheet behind a four-tab dock, and a padlock that turns a drag on a shape into a pan. The state-machine board has not been given that pair yet — the open remainder of this scenario
**Resolution**: ✅ The designer is usable on a phone

### Scenario: One Designer, Many Documents
**Desired Outcome**: An agent moves a person's canvas from document to document without anyone restarting a server
**Current Reality**: ~~The web app bound its document per process~~ — `?doc=<absolute path>` chooses the document, `/api/file` accepts it against a root allowlist, `set_project_file` returns the link that opens it, and back/forward walk documents because navigation writes history
**Resolution**: ✅ One designer, any document the allowlist permits — and a `.erdf.json` opens the ERD workspace instead

### Scenario: A Published Designer Nobody Has to Build
**Desired Outcome**: `npx -y @miadi/stateloom-web` serves a working canvas against whichever hub the operator runs
**Current Reality**: ~~The bridge URL was inlined at build time, so a published bundle carried one person's URL~~ — the browser asks `GET /api/config`, answered by the server process the operator started from their own `STATELOOM_BRIDGE_URL`. A redeploy is a restart, never a rebuild
**Resolution**: ✅ The designer stopped being the one thing you had to clone to run

## Dependencies

- **Spec 70 (SMDF)**: Data model rendered and edited by the designer
- **Spec 72 (Code Generator)**: Generate button invokes `smcg` through `POST /api/generate`
- **Spec 73 (MCP Server)**: Shares the same document; `set_project_file` re-points both surfaces and hands back the canvas link
- **Spec 75 (Agent↔Designer Bridge)**: `/api/file` + `/api/watch` SSE — the fallback layer beneath the socket
- **Spec 76 (RISE Rispec Generator)**: the 📜 RISE button and `POST /api/rispec`
- **Spec 77 (Real-Time Design Bridge)**: `SocketBridgeProvider`, `applyRemoteOps`, presence, live-state pulses
- **Spec 80 (ERDF Format)**: the second workspace this app opens
- **`@miadi/stateloom-canvas`**: the board itself, shared with forgewright
