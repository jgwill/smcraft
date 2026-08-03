# SMDF reference — the `.smdf.json` format

The State Machine Definition Format is one JSON document with three top-level sections. It is
the input to code generation, the model the visual designer edits, and the object the MCP
tools mutate. Canonical extension: `.smdf.json`.

A file may store the definition bare, or wrapped in `{ "stateMachine": … }`.

```json
{
  "stateMachine": {
    "settings": { },
    "events":   [ ],
    "state":    { }
  }
}
```

**Which readers accept which form — verified:**

| Reader | Wrapped | Bare |
|---|---|---|
| MCP server, `smcx`, the hub, the web designer | yes | yes |
| `smcg` (Python CLI) | **no** — fails with `Error parsing …: 'settings'` | yes |

Every writer in the loop (MCP `writeDef`, `smcx`, the web `PUT /api/file`) emits the
**wrapped** form. So a document produced by the tools cannot be handed straight to `smcg`.
Unwrap it first:

```bash
jq '.stateMachine // .StateMachine // .' machine.smdf.json > /tmp/machine.bare.smdf.json
smcg /tmp/machine.bare.smdf.json -o out/ -v
```

The MCP `generate_code` tool and the web Generate button already do this unwrapping
internally — the seam only shows when you invoke `smcg` yourself.

---

## 1. `settings`

| Field | Type | Meaning |
|---|---|---|
| `namespace` | string | Package / module namespace for generated code |
| `name` | string | The machine's name. Drives class names, output file names, and export file names |
| `asynchronous` | boolean | `true` generates an async context (`ContextAsync`) |
| `objects` | array | `{ "instance": "strategy", "class": "BDBOStrategyEntity" }` — entities the generated context holds |
| `context` | object | `{ "class": "BDBOStrategyContext" }` — overrides the generated context class name |
| `_source` | object | Provenance. `{ kind, pdeId, pdeFolder, originalPrompt, engine }` — read by `generate_rispec` |

```json
"settings": {
  "namespace": "Trading.Strategies",
  "name": "BDBOStrategy",
  "asynchronous": false,
  "objects": [ { "instance": "strategy", "class": "BDBOStrategyEntity" } ],
  "context": { "class": "BDBOStrategyContext" }
}
```

---

## 2. `events`

An array of **event sources**. Each source groups the events that arrive through one external
interface, and generates one typed dispatch class (a *feeder*).

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Source name |
| `feeder` | string | Generated dispatcher class name |
| `events` | array | The events themselves |
| `timers` | array | Timers whose expiry raises an event |

An event:

```json
{
  "id": "PriceBreakout",
  "description": "Price crossed the breakout level",
  "parameters": [
    { "name": "price",     "type": "float"  },
    { "name": "direction", "type": "string" }
  ]
}
```

A timer:

```json
{ "id": "evTimeout", "name": "Timeout" }
```

Timer IDs share a namespace with event IDs — a collision is canonical V004.

```json
"events": [
  {
    "name": "StrategyEvents",
    "feeder": "StrategyFeeder",
    "events": [
      { "id": "StrategyCreated", "parameters": [ { "name": "strategyId", "type": "string" } ] },
      { "id": "SignalFound" },
      { "id": "OrderFilled" }
    ],
    "timers": [ { "id": "evTimeout", "name": "Timeout" } ]
  }
]
```

The MCP `add_event` tool always writes into source index 0. Several named sources require
`load_definition`.

---

## 3. `state` — the hierarchy

One tree, rooted at a state named `Root`.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Unique across the **entire** tree, at every depth |
| `kind` | string | `normal` (default), `final`, `history` |
| `description` | string | Human-readable purpose. Surfaces in diagrams, rispecs, docstrings |
| `states` | array | Child states. Non-empty makes this state composite |
| `transitions` | array | Event-triggered changes |
| `onEntry` | array | Actions run when the state is entered |
| `onExit` | array | Actions run when the state is left |
| `parallel` | object | Orthogonal regions — `{ "states": [ region, region ] }` |

### State classification

| Kind | Recognized by |
|---|---|
| Leaf | no `states`, no `parallel` |
| Composite | `states` is non-empty |
| Final | `kind: "final"` (the parser also treats a name ending in `Final` as a convention) |
| History | `kind: "history"` (name ending in `History` by convention) |
| Parallel | `parallel` present |
| Root | the top-level state — always composite |

### Transitions

```json
{
  "event": "OrderApproved",
  "nextState": "Active",
  "condition": "order.total > 1000",
  "description": "Large orders route to manual fulfilment",
  "actions": [ { "code": "notify_warehouse()" } ]
}
```

Omit `nextState` for an internal transition — the event is handled without leaving the state.
A transition declared on a composite state expresses hierarchical inheritance in the model
(and draws that way); see the codegen caveat in the `stateloom-codegen` skill before relying
on it at runtime.

### Actions

The key is **`actions`, an array** — on a transition directly, and inside an `onEntry` /
`onExit` object:

```json
"onEntry": { "actions": [ { "code": "open_ledger()" } ] },
"onExit":  { "actions": [ { "timerStop": "RetryTimer" } ] }
```

Three action forms:

```json
{ "code": "initialize()" }
{ "timerStart": { "timer": "RetryTimer", "duration": "1000" } }
{ "timerStop": "RetryTimer" }
```

**`code` is emitted as `context.<code>`** — verified. So `{ "code": "initialize()" }` becomes
`context.initialize()` in the generated handler. Write the expression as a member of the
context and implement it on a subclass of the generated context class:

```python
class MyContext(OrderWorkflowContext):
    def initialize(self): ...
```

`{ "code": "self.initialize()" }` would generate `context.self.initialize()` and fail. Some
older spec text shows a singular `"action": { … }` on a transition — the parser reads
`actions`, so use the array.

### Parallel regions

```json
{
  "name": "Running",
  "parallel": {
    "states": [
      { "name": "Motor",   "states": [ { "name": "MotorIdle" }, { "name": "MotorSpinning" } ] },
      { "name": "Heater",  "states": [ { "name": "HeaterOff" }, { "name": "HeaterOn" } ] }
    ]
  }
}
```

At least two regions, each with at least one child (canonical V010). Note: the current Python
generator does not emit region contexts for parallel states — model them, but check the
generated output before relying on it.

---

## Validation rules — canonical V001–V014

Run by `smcg` and by the Python / TypeScript parsers. `smcg <file> --validate-only` prints
them; the exit code is non-zero when any fire.

| Rule | Checks |
|---|---|
| V001 | Exactly one root state |
| V002 | State names unique across the entire tree |
| V003 | Event IDs unique across all sources |
| V004 | Timer IDs unique and never colliding with an event ID |
| V005 | Every transition's `event` names a defined event |
| V006 | Every transition's `nextState` names a defined state |
| V007 | Final states have no outgoing transitions |
| V008 | Final states have no children |
| V009 | Composite states designate a valid initial child — the **first child is implicitly initial**, so a composite whose children are all `final` or `history` fires this |
| V010 | Parallel states have ≥2 regions, each with ≥1 child |
| V011 | A transition inside a parallel region targets the same region or a parent exit |
| V012 | Composite states have ≥1 child |
| V013 | At least one event source is defined |
| V014 | Timer references in actions name a defined timer |

### The MCP subset — different meanings, overlapping IDs

The MCP `validate_definition` tool implements a fast five-rule structural check whose IDs do
**not** line up with the canonical table:

| MCP ID | MCP message | Nearest canonical rule |
|---|---|---|
| V001 | No events defined | V013 |
| V002 | Duplicate state name | V002 |
| V003 | State references unknown event | V005 |
| V004 | State targets unknown state | V006 |
| V005 | Root must have at least one child state | V012 |

Treat the MCP check as a quick gate during design and `smcg --validate-only` as the gate
before generating code.

---

## Legacy format

`.fsm` — XML, `StateMachineDotNet-v1` namespace. The parser auto-detects by extension and
content. Read-only in practice; write `.smdf.json`.

---

## Minimal valid document

```json
{
  "stateMachine": {
    "settings": { "namespace": "MyApp", "name": "OrderWorkflow", "asynchronous": false },
    "events": [
      {
        "name": "OrderEvents",
        "feeder": "OrderFeeder",
        "events": [
          { "id": "OrderCreated", "parameters": [ { "name": "orderId", "type": "string" } ] },
          { "id": "OrderApproved" },
          { "id": "OrderCompleted" }
        ]
      }
    ],
    "state": {
      "name": "Root",
      "states": [
        { "name": "Pending",   "transitions": [ { "event": "OrderCreated",   "nextState": "Active"    } ] },
        { "name": "Active",    "transitions": [ { "event": "OrderApproved",  "nextState": "Completed" } ] },
        { "name": "Completed", "kind": "final" }
      ]
    }
  }
}
```
