# Runtime Engine

> RISE Framework Specification
> References: CAISHEN Spec 61 (State Machine Runtime)

**Spec ID**: 71
**Version**: 1.0
**Source**: Extracted from `smcraft/py/smcraft/runtime.py`, `smcraft/ts/src/runtime.ts`
**Implementation**: Python (`py/smcraft/runtime.py`), TypeScript (`ts/src/runtime.ts`)

## Creative Intent

**What the Runtime Enables Users to Create:**
Executable state machines from SMDF definitions — hierarchical entry/exit chains, event-driven transitions, timer management, and observable lifecycle hooks — in both synchronous and asynchronous modes.

**Desired Outcomes:**
1. Generated code runs immediately with correct state hierarchy semantics
2. Async mode enables non-blocking event processing for real-time systems
3. Observers provide monitoring without modifying state machine logic
4. State serialization enables persistence and recovery

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
- `ObserverLogger` — Logs via Python `logging` module

## Structural Tensions

### Parallel Region Execution
**Current Reality**: Runtime has no `ContextParallel` — orthogonal regions cannot execute concurrently
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
