# Runtime Engine

> RISE Framework Specification
> References: CAISHEN Spec 61 (State Machine Runtime)

**Spec ID**: 71
**Version**: 1.1
**Source**: Extracted from `py/stateloom/runtime.py`, `ts/src/runtime.ts`, `ts/src/machine.ts`
**Implementation**: Python (`py/stateloom/runtime.py`, PyPI `miadi-stateloom-engine`), TypeScript (`ts/src/runtime.ts` + `ts/src/machine.ts`, npm `@miadi/stateloom-engine`)
**Revised**: 2026-09-20 — package rename, npm subpath exports, and the `Machine` interpreter (a second execution path that did not exist at v1.0)

## Creative Intent

**What the Runtime Enables Users to Create:**
Executable state machines from SMDF definitions — hierarchical entry/exit chains, event-driven transitions, timer management, and observable lifecycle hooks — in both synchronous and asynchronous modes.

**Desired Outcomes:**
1. Generated code runs immediately with correct state hierarchy semantics
2. Async mode enables non-blocking event processing for real-time systems
3. Observers provide monitoring without modifying state machine logic
4. State serialization enables persistence and recovery
5. A definition runs without being generated first — the interpreter path

## Two Execution Paths

The runtime is reached two ways, and they share the same `Context`, `State`, `TransitionHelper` and observer machinery.

| Path | Entry point | When |
|---|---|---|
| **Generated** | `smcg` (Python) or `TypeScriptCodeGenerator` (Spec 72) emits classes that import the runtime as a dependency | The machine ships as source you read, edit and commit |
| **Interpreted** | `new Machine(definition)` — `@miadi/stateloom-engine/machine`, TypeScript only | The definition is the artefact; nothing is generated. This is the path forgewright and the live loom take |

### npm subpath exports (`@miadi/stateloom-engine`)

| Subpath | Carries |
|---|---|
| `.` | barrel — model types, parser, runtime, `TypeScriptCodeGenerator`, `Machine` |
| `./runtime` | `ContextBase`, `Context`, `ContextAsync`, `State`, `StateKind`, `TransitionHelper`, `IObserver`, `ObserverNull`, `ObserverConsole` |
| `./machine` | `Machine`, `MachineDefinitionError`, `listTransitions` |
| `./parser` | `parseJson`, `parseFile`, `enrich`, `validate` |
| `./codegen` | `TypeScriptCodeGenerator` |

Generated TypeScript imports `./runtime` by name, so a generated file compiles against the published package with no path juggling. Python mirrors the same surface as `stateloom.model`, `stateloom.parser`, `stateloom.runtime`, `stateloom.codegen`, `stateloom.cli`.

## Core Concepts

### StateKind
```python
class StateKind(Enum):
    LEAF = "leaf"
    COMPOSITE = "composite"
    FINAL = "final"
    HISTORY = "history"
    PARALLEL = "parallel"
    ROOT = "root"
```

### State
Runtime representation of a single state node.

| Property | Type | Description |
|----------|------|-------------|
| `name` | str | State identifier |
| `kind` | StateKind | Classification |
| `parent` | State | Parent in hierarchy |
| `on_entry` | Callable | Entry action callback |
| `on_exit` | Callable | Exit action callback |

### Context (Synchronous)
Manages the state machine lifecycle for immediate event processing.

**Behavior:**
- `enter_initial_state()` — Walks from Root down to deepest initial child, firing on_entry at each level
- `on_<event>(params)` — Dispatches event to current state's handler
- `transition_to(target, actions)` — Computes LCA, exits up, enters down, fires actions

**State Tracking:**
- `current_state` — Active leaf state
- `previous_state` — Last state before transition
- `next_state` — Target during transition (None when idle)

### ContextAsync
Extends Context with thread-safe event queue.

**Behavior:**
- Events enqueued via `deque` (thread-safe)
- Processing loop dequeues and dispatches sequentially
- Ensures no concurrent event handling
- Start/stop lifecycle management

### TransitionHelper
Orchestrates hierarchical state transitions.

**Algorithm:**
1. Find LCA (Lowest Common Ancestor) of source and target states
2. Exit from current state up to LCA (child → parent order)
3. Execute transition actions
4. Enter from LCA down to target state (parent → child order)

```
Current: A.B.C  →  Target: A.D.E
LCA: A
Exit: C.on_exit → B.on_exit
Actions: transition_action()
Enter: D.on_entry → E.on_entry
```

### Timer Management
- `start_timer(name, duration_ms, callback)` — Spawns daemon thread
- `stop_timer(name)` — Cancels pending timer
- Timer expiry fires the associated event
- All timers cancelled on context disposal

### Observer Protocol
```python
class IObserver(Protocol):
    def on_entry(self, context, state): ...
    def on_exit(self, context, state): ...
    def on_transition_begin(self, context, source, target, event): ...
    def on_transition_end(self, context, source, target, event): ...
    def on_timer_start(self, context, timer_name, duration): ...
    def on_timer_stop(self, context, timer_name): ...
```

**Built-in Observers:**
- `ObserverNull` — No-op (default)
- `ObserverConsole` — Prints lifecycle events to stdout
- `ObserverLogger` — Logs via Python `logging` module. **Python only** — the TypeScript runtime ships `ObserverNull` and `ObserverConsole` and leaves logging to the host

## Machine — the SMDF interpreter (TypeScript)

`Machine extends Context`. It builds the `State` objects from the definition at construction time instead of receiving them from generated code, so a `.smdf.json` runs the moment it is parsed.

```typescript
import { Machine } from "@miadi/stateloom-engine/machine";
const m = new Machine(definition);   // validates, then enters the initial state
m.send("Start");                     // → SendResult
m.state;                             // current leaf name
m.path;                              // ["Root", "Active", "Running"]
m.done;                              // true once a final state was entered
```

| Member | Behaviour |
|---|---|
| `constructor(def, options?)` | Enriches, validates, builds states, enters the initial state. Fatal rule violations throw `MachineDefinitionError`; non-fatal ones land in `warnings` |
| `send(eventId, payload?)` | Returns `SendResult` — `{ handled, changed, from, to, event, error? }`. An unhandled event is reported, not thrown |
| `state` / `path` / `done` | Current leaf, root-to-leaf chain, terminal flag |
| `availableEvents()` | Event ids with a transition declared anywhere on the current chain — what a UI offers next |
| `setState(name)` | Restore a persisted machine: jump without firing exit/entry chains, descending a composite to its initial leaf |
| `stop()` | End the machine and release timers; later sends are rejected |
| `visited` | Leaf names in visit order, starting with the initial state |
| `warnings` | Non-fatal `ValidationError[]` from construction |

**Options** — `validate: false` skips the check, `guard` supplies the condition evaluator (default: `Boolean(context[condition])`), `context` is the object guards read, `observer` and `name` pass through to `Context`.

**Limit:** the interpreter refuses a definition containing parallel regions, by name, at construction. The generated path has the same hole — see the tension below. `listTransitions(definition)` is the pure companion: every edge in the document, for anything that needs to draw or count them without running anything.

## Structural Tensions

### Parallel Region Execution
**Current Reality**: Runtime has no `ContextParallel` — orthogonal regions cannot execute concurrently. The `Machine` interpreter refuses such a definition at construction rather than running it wrongly, so the hole is visible at the boundary instead of at runtime
**Desired Outcome**: Parallel states spawn sub-contexts per region, track completion, synchronize exit
**Resolution Path**: Implement `ContextParallel` following CAISHEN Spec 61 patterns — region completion counting, synchronized entry/exit

### History State Memory
**Current Reality**: Single `state_history` on context — only tracks one level
**Desired Outcome**: Per-composite-state history memory enabling return-to-last-active-child
**Resolution Path**: Dictionary mapping composite state names to their last active child

### Timer-Async Integration
**Current Reality**: Timers use daemon threads, not cooperative with async event loop
**Desired Outcome**: Timer events integrate naturally with ContextAsync queue
**Resolution Path**: Timer expiry posts events to the async queue instead of direct callback

## Creative Advancement Scenarios

### Scenario: Trading Strategy Execution
**Desired Outcome**: 13-state FDB Breakout Strategy FSM runs autonomously, transitioning on market events
**Current Reality**: Strategy definition exists in SMDF
**Natural Progression**: Generated code instantiates Context, enters WAITING_BREAKOUT, processes EvBreakoutDetected → transitions through lifecycle
**Resolution**: Strategy FSM executes with full hierarchical entry/exit semantics and timer-based timeouts

### Scenario: Observable State Machine for Debugging
**Desired Outcome**: Developer watches every state transition in real-time during development
**Current Reality**: State machine runs but transitions are opaque
**Natural Progression**: Attach ObserverConsole → every entry, exit, transition logged → developer sees exact execution path
**Resolution**: Full visibility into state machine behavior without code modification

## Dependencies

- **Spec 70 (SMDF)**: Defines the format that runtime executes
- **Spec 72 (Code Generator)**: Produces the code that creates runtime objects
- **Spec 77 (Real-Time Design Bridge)**: A running `Machine` emits `runtime.enter` / `runtime.exit` onto the hub, which is how a live board lights up the state a real machine is in
