# SMDF — State Machine Definition Format

> RISE Framework Specification
> References: CAISHEN Spec 60 (State Machine Definition Format)

**Spec ID**: 70
**Version**: 1.1
**Source**: Extracted from `py/stateloom/model.py`, `py/stateloom/parser.py`
**Implementation**: Python (`py/stateloom/`, PyPI `miadi-stateloom-engine`), TypeScript (`ts/src/`, npm `@miadi/stateloom-engine`), MCP (`mcp/src/server.ts`)
**Revised**: 2026-09-20 — package directories renamed (`py/smcraft/` → `py/stateloom/`); ERDF (Spec 80) named as the sibling document type

## Creative Intent

**What SMDF Enables Users to Create:**
A declarative JSON schema where humans and LLM agents describe stateful workflows — hierarchical, parallel, timed — in a single file that feeds code generation, visual design, and runtime execution.

**Desired Outcomes:**
1. A user writes one `.smdf.json` file and gets working state machine code in Python or TypeScript
2. The visual designer imports/exports the same format — no translation layer
3. MCP tools manipulate the same model — agents design state machines conversationally
4. Validation catches structural errors before code generation

## Core Concepts

### StateMachineDefinition
Root container holding `settings`, `eventSources`, and the `state` tree.

```json
{
  "settings": { "namespace": "...", "name": "...", "asynchronous": true },
  "eventSources": [ { "name": "...", "feeder": "...", "events": [...] } ],
  "state": { "name": "Root", "states": [...] }
}
```

### StateDef (State Definition)
A node in the state hierarchy tree. Properties:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique state identifier |
| `states` | StateDef[] | Child states (composite if non-empty) |
| `transitions` | TransitionDef[] | Event-triggered state changes |
| `onEntry` | ActionDef[] | Actions executed on state entry |
| `onExit` | ActionDef[] | Actions executed on state exit |
| `parallel` | ParallelDef | Orthogonal regions (parallel state) |
| `description` | string | Human-readable purpose |
| `notes` | string | Working notes about this state — what a person or an agent wrote down while discussing it, for whoever opens the document next. `settings.notes` carries the same for the whole diagram. Not part of the machine: parsers, engines and the code generator ignore it. MCP: `get_notes`, `set_notes` |

**State Classification (derived):**
- **Leaf**: `states == [] AND parallel == None`
- **Composite**: `len(states) > 0`
- **Final**: name ends with `Final` (convention)
- **History**: name ends with `History` (convention)
- **Parallel**: `parallel != None`
- **Root**: top-level state (always composite)

### EventDef
```json
{ "id": "EvStart", "parameters": [{ "name": "data", "type": "string" }] }
```

### TransitionDef
```json
{ "event": "EvStart", "nextState": "Running", "condition": "is_ready", "action": { "code": "self.initialize()" } }
```

### ActionDef
Three forms:
1. **Code**: `{ "code": "self.do_something()" }`
2. **Timer Start**: `{ "timerStart": { "timer": "TimerName", "duration": "1000" } }`
3. **Timer Stop**: `{ "timerStop": "TimerName" }`

### TimerDef
```json
{ "name": "RetryTimer", "event": "EvRetryTimeout" }
```

### ParallelDef
```json
{ "states": [ { "name": "Region1", "states": [...] }, { "name": "Region2", "states": [...] } ] }
```

### EventSourceDef
Groups events by their external interface (feeder). Each source generates a typed dispatch class.

## Validation Rules

**Which validator you are holding matters.** The format specifies fourteen rules; the two
engines do not carry the same subset. `✅ Implemented` below means the **Python** engine,
which implements all fourteen. The TypeScript engine implements V001, V002, V003, V005,
V006, V007 and V013 — so V004, V008, V009, V010, V011, V012 and V014 are found by `smcg`
and not by `validate()` in JavaScript. The MCP server's `validate_definition` runs its own
reference and uniqueness set whose **rule ids are not these**: its V001 is "no events
defined", its V004 an unknown transition target, its V005 "root has no child state". Read
the message, not the number.

| Rule | Description | Status (Python) |
|------|-------------|--------|
| V001 | Exactly one root state | ✅ Implemented |
| V002 | Unique state names across entire tree | ✅ Implemented |
| V003 | Unique event IDs across all sources | ✅ Implemented |
| V004 | Timer IDs unique, no collision with event IDs | ✅ Implemented |
| V005 | Transition events reference defined event IDs | ✅ Implemented |
| V006 | Transition nextState references defined state names | ✅ Implemented |
| V007 | Final states have no outgoing transitions | ✅ Implemented |
| V008 | Final states have no children | ✅ Implemented |
| V009 | Composite states should designate an initial child | ✅ Implemented |
| V010 | Parallel states must have ≥2 regions, each with ≥1 child | ✅ Implemented |
| V011 | Parallel region transitions: nextState must be within same region or to parent exit | ✅ Implemented |
| V012 | Composite states must have ≥1 child | ✅ Implemented |
| V013 | At least one event source defined | ✅ Implemented |
| V014 | Timer references in actions must reference defined timer names | ✅ Implemented |

## File Format

**Canonical**: `.smdf.json` (JSON)
**Legacy**: `.fsm` (XML, StateMachineDotNet-v1 namespace)

The parser auto-detects format by file extension and content inspection.

## Creative Advancement Scenarios

### Scenario: Agent Designs a Trading Strategy FSM
**Desired Outcome**: LLM agent creates a 13-state FDB Breakout Strategy definition via MCP tools
**Current Reality**: Agent has trading domain knowledge but no state machine structure
**Natural Progression**: Agent calls `create_state_machine`, iteratively `add_state`/`add_event`/`add_transition`, `validate_definition` catches errors, adjusts, exports `.smdf.json`
**Resolution**: Valid SMDF file ready for code generation and visual review

### Scenario: Human Designs Composite Workflow
**Desired Outcome**: User creates nested state machine with parallel regions in the web designer
**Current Reality**: ~~Web designer shows flat state view~~ — drill-down landed (Spec 74). Double-click a composite state and the canvas shows only its children; a breadcrumb walks back up
**Natural Progression**: User creates parent state, drills into it, adds child states with transitions, navigates back; SMDF captures full hierarchy
**Resolution**: Hierarchical `.smdf.json` with composite and parallel states

## Dependencies

- **Spec 71 (Runtime)**: Consumes SMDF definitions for execution
- **Spec 72 (Code Generator)**: Transforms SMDF into executable code
- **Spec 73 (MCP Server)**: Manipulates SMDF on disk via tools
- **Spec 74 (Web Designer)**: Visual editing of SMDF structure
- **Spec 77 (Real-Time Design Bridge)**: Carries SMDF as the document type in every patch envelope
- **Spec 80 (ERDF Format)**: The sibling document type. A `.smdf.json` describes one behaviour; a `.erdf.json` describes the data every behaviour acts on. The link is by name — `settings.objects[].class` names an entity, a guard's `<instance>.<field>` names an attribute
