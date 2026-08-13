---
name: stateloom-design
description: Design a hierarchical state machine conversationally through the stateloom / smcraft MCP tools. Use when creating or editing a .smdf.json state machine, calling create_state_machine, add_state, add_event, add_transition, remove_state, list_states, list_events, load_definition or validate_definition, building nested composite states, choosing state kinds (normal, final, history), fixing V001-V005 validation errors, or switching the active project document with set_project_file.
---

# Designing a state machine through the MCP tools

The tools mutate one file: the active `.smdf.json` document. Every call is
`read file → mutate → write file → emit to the live bridge`. There is no in-memory session —
the file *is* the session, so a crash loses nothing and a second surface sees every change.

Read `smdf-reference.md` beside this skill for the full schema, the validation rules, and the
constructs the granular tools cannot express.

---

## Step 0 — Know which document you are editing

Always call this first. Never assume.

```
get_project_file
```

It reports the absolute path, whether a machine already lives there, and bridge status. If it
is the wrong document:

```
set_project_file  { "path": "/absolute/path/to/film-preprod.smdf.json" }
```

Both the disk target **and** the live bridge room re-point, because rooms are keyed by
absolute path. A missing file is a legitimate target — the next `create_state_machine` or
`load_definition` writes it. The path must end in `.json`; the convention is `.smdf.json`.

---

## The 15 tools

| Group | Tools |
|---|---|
| Create / mutate | `create_state_machine`, `add_state`, `add_event`, `add_transition`, `remove_state`, `load_definition` |
| Inspect | `get_definition`, `list_states`, `list_events`, `get_project_file` |
| Act | `validate_definition`, `generate_code`, `generate_rispec`, `render_diagram` |
| Document | `set_project_file`, `get_project_file` |

There is also the MCP resource `smcraft://definition` (the current definition as JSON) and the
MCP prompt `design-state-machine` (a guided design conversation).

---

## The order that works

**Events before transitions. Always.** A transition names an event; if that event does not
exist yet, `validate_definition` reports V003. This is the single most common mistake.

```
1. create_state_machine   namespace + name
2. add_event   × N        every trigger the machine can receive
3. add_state   × N        parents before children
4. add_transition × N     now that both endpoints exist
5. validate_definition    read it, fix, re-run until clean
6. render_diagram / generate_code / generate_rispec
```

### 1. Create

```
create_state_machine { "namespace": "Orders", "name": "OrderWorkflow", "asynchronous": false }
```

Writes a skeleton: one event source called `Internal` with no events, and a `Root` state with
no children. `asynchronous: true` makes the Python generator emit `ContextAsync` instead of
`Context`.

Working on an existing machine instead? Point at it and inspect — do not recreate:

```
set_project_file { "path": "/abs/path/existing.smdf.json" }
list_states
list_events
```

`create_state_machine` **overwrites** the file. Use it only for a new machine.

### 2. Events

```
add_event { "id": "OrderCreated",  "description": "A customer placed an order" }
add_event { "id": "OrderApproved" }
add_event { "id": "OrderCancelled" }
```

Every event lands in event source index 0 (`Internal`). Event IDs must be unique across all
sources. Descriptions are worth writing — they surface in `list_events`, in the rispec, and in
the generated code's docstrings.

To use several named event sources with feeders, timers or typed parameters, build the JSON
yourself and `load_definition` it (see the escape hatch below).

### 3. States

```
add_state { "name": "Pending",   "description": "Awaiting approval" }
add_state { "name": "Active",    "description": "Order is being fulfilled" }
add_state { "name": "Completed", "kind": "final" }
```

`parent` defaults to `Root`. `kind` is one of `normal` (default), `final`, `history`.

**Hierarchy** — pass `parent` to nest, and add parents before children:

```
add_state { "name": "Active" }
add_state { "name": "Picking",  "parent": "Active" }
add_state { "name": "Packing",  "parent": "Active" }
add_state { "name": "Shipping", "parent": "Active" }
```

`Active` is now a composite state: it has children, so it is never entered directly — the
machine enters one of its leaves. A state is composite purely by having children; there is no
separate flag.

`add_state` fails with `Parent state 'X' not found.` if the parent does not exist yet. That
error is your ordering check.

### 4. Transitions

```
add_transition { "state": "Pending", "event": "OrderApproved", "nextState": "Active" }
add_transition { "state": "Picking", "event": "ItemScanned",   "nextState": "Packing" }
add_transition { "state": "Active",  "event": "OrderCancelled","nextState": "Cancelled" }
```

- `state` — the state that reacts. It must already exist, or the tool errors.
- `event` — must already exist as an event, or V003 fires at validation.
- `nextState` — omit it for an **internal transition**: the event is handled, no state change.
- `condition` — a guard expression, emitted verbatim into the generated code
  (`"condition": "order.total > 1000"`).
- `description` — free text.

A transition on a **composite** state (`Active` above) expresses hierarchical inheritance in
the model: every leaf inside `Active` is meant to handle `OrderCancelled`. It draws that way
in every diagram surface, and it is the right way to express a shared exit.

**Codegen caveat, verified:** the Python generator emits event handlers on **leaf** state
classes only. A composite is emitted as a plain `State(kind=StateKind.COMPOSITE)` with no
handlers, so at runtime a leaf will not react to its parent's transition. If the generated
code must honour a shared exit, declare that transition on each leaf as well — or keep the
composite declaration for the model and add the leaf declarations for execution.

### 5. Validate

```
validate_definition
```

Clean output is exactly `✓ Definition is valid. No errors found.` Anything else is a list:

```
Found 2 validation error(s):
[V003] State 'Pending' references unknown event 'OrderApprove'
[V004] State 'Active' targets unknown state 'Complete'
```

---

## Reading validation output

The MCP tool runs a fast structural check with **its own five rule IDs**:

| MCP rule | Means | Fix |
|---|---|---|
| `V001` | No events defined at all | `add_event` |
| `V002` | Duplicate state name | Rename — names must be unique across the whole tree, at every depth |
| `V003` | A transition names an event that does not exist | Add the event, or correct the spelling in the transition |
| `V004` | A transition targets a state that does not exist | Add the state, or correct the `nextState` |
| `V005` | `Root` has no child states | `add_state` |

The **canonical** rule set — V001–V014, run by `smcg` and the Python/TypeScript parsers — is a
different, larger numbering. The MCP check is a subset with overlapping IDs, not the same
list. When you need the full check, run it against the file:

```bash
smcg /absolute/path/to/machine.smdf.json --validate-only
```

The full V001–V014 table is in `smdf-reference.md`. The rules the MCP check does **not** cover
and that bite most often: final states with outgoing transitions (V007), final states with
children (V008), composite states with no children (V012), and duplicate event IDs (V003
canonical).

---

## Common mistakes

| Mistake | Symptom | Remedy |
|---|---|---|
| Adding a transition before its event exists | `[V003] … references unknown event` | Add all events first — that is why step 2 precedes step 4 |
| Adding a child before its parent | `Parent state 'X' not found.` | Parents before children, always |
| A state nothing transitions into | No error; the state is unreachable | `list_states`, then read every `→ [event] → target` line and find names that never appear as a target |
| A state with no way out | No error; the machine deadlocks there | Every non-`final` leaf needs at least one outgoing transition |
| Reusing a name at a different depth | `[V002] Duplicate state name` | State names are globally unique — prefix them (`Active_Picking`) |
| Giving a `final` state a transition | Canonical V007 (`smcg` only, MCP passes it) | Final states are terminal; remove the transition or drop `kind: "final"` |
| Calling `create_state_machine` on an existing machine | The file is silently replaced | `set_project_file` + `list_states` first; use `load_definition` to replace deliberately |
| Editing the file by hand while an agent holds it | Last write wins | Let the hub reconcile — it diffs external edits and broadcasts them (see `stateloom-live-loop`) |

---

## Inspecting as you go

`list_states` prints the tree with transitions, indented by depth:

```
Root
  Pending — 1 transition(s)
    → [OrderApproved] → Active
  Active — 1 transition(s)
    → [OrderCancelled] → Cancelled
    Picking — 1 transition(s)
      → [ItemScanned] → Packing
    Packing — 0 transition(s)
  Completed (final) — 0 transition(s)
```

`list_events` prints `id — description` per line. `get_definition` returns the whole JSON —
use it before a risky change so you can `load_definition` your way back.

---

## The escape hatch: `load_definition`

The granular tools cover states, events and transitions. The SMDF format carries more:
`parallel` regions, timers, typed event parameters, `onEntry` / `onExit` action lists,
multiple named event sources with feeders, and `settings.objects` / `settings.context`.

To use those, construct the JSON and load it whole:

```
load_definition { "json": "{\"settings\":{…},\"events\":[…],\"state\":{…}}" }
```

It accepts a bare definition or one wrapped in `{ "stateMachine": … }`, replaces the document
entirely, and emits a full-definition update to every live surface. It reports what it loaded:
`Loaded definition → /abs/path.smdf.json: OrderWorkflow (6 states, 4 events)`.

Round-trip safely: `get_definition` → edit the JSON → `load_definition`.

---

## Worked example — a traffic light with a pedestrian phase

```
create_state_machine { "namespace": "City", "name": "TrafficLight" }

add_event { "id": "TimerElapsed",  "description": "Phase timer fired" }
add_event { "id": "PedestrianCall","description": "Button pressed at the crossing" }
add_event { "id": "PowerLost" }

add_state { "name": "Operating", "description": "Normal signalling cycle" }
add_state { "name": "Red",    "parent": "Operating" }
add_state { "name": "Green",  "parent": "Operating" }
add_state { "name": "Amber",  "parent": "Operating" }
add_state { "name": "Dark",   "kind": "final", "description": "Power failure — signal off" }

add_transition { "state": "Red",       "event": "TimerElapsed",   "nextState": "Green" }
add_transition { "state": "Green",     "event": "TimerElapsed",   "nextState": "Amber" }
add_transition { "state": "Amber",     "event": "TimerElapsed",   "nextState": "Red" }
add_transition { "state": "Green",     "event": "PedestrianCall", "nextState": "Amber",
                 "condition": "green_elapsed > 10" }
add_transition { "state": "Operating", "event": "PowerLost",      "nextState": "Dark" }

validate_definition
```

Note what the shape buys: `PowerLost` is declared once on `Operating`, so the model says
"any phase can lose power" in one line; the pedestrian call is guarded so a button press
cannot cut a green short; `Dark` is `final` and therefore has no way out, which is exactly
what a power failure means. This exact machine ships as `example.smdf.json` beside this skill
and passes `smcg --validate-only` unchanged.

Before generating code from it, apply the composite caveat above — add `PowerLost` to `Red`,
`Green` and `Amber` too, or the generated Python will ignore it.

Then look at it and move on:

- `render_diagram { "format": "png" }` — see it (skill: `stateloom-render`)
- `generate_code { "language": "python" }` — run it (skill: `stateloom-codegen`)
- `generate_rispec` — specify it (skill: `stateloom-rispec`)

---

## When the live canvas is running

Every mutating tool persists to disk and then emits to the hub, so a human watching the web
designer sees each state bloom as you add it. Design in small, narratable steps rather than
one `load_definition` dump — the human is reading the board while you work. That loop is the
subject of the `stateloom-live-loop` skill.
