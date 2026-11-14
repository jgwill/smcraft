# DMDF — Decision Model Definition Format

> RISE Framework Specification
> References: Spec 70 (SMDF Format), Spec 80 (ERDF Format), Spec 81 (SQDF Format), Spec 82 (System Definition), Spec 83 (The Stage and the Marks); OMG Decision Model and Notation (DMN) 1.5

**Spec ID**: 85
**Version**: 0.1
**Status**: proposed. Nothing implemented. Its name, its extension and the four questions at the end belong to Guillaume (Episode 121's format circle, Episode 564).
**Implementation**: none yet. The first document is `advance-gate.dmdf.json` in Episode 564 (`2026-10-26-episode-564-jev-decides-with-the-factory/advance-gate-261114/`), with a hand-written Mermaid view beside it (`advance-gate.dmd.mmd`, `.png`).
**Origin**: jgwill/smcraft#32. Guillaume, 2026-11-14: "I was really thinking about upgrading the factory to support a fourth new type of diagram, which is a decision model that is based on try to represent what you try to do when you use that decision engine to help you choose. So I would have a representation about the decision model ... I'm pretty sure there is a diagram type that enable us to actually represent decisions." Grounded in `miadi-foundation:decision-modelling-notations` (held by Episode 564).

## Creative Intent

**What DMDF Enables Users to Create:**
A declarative JSON document where a person and an agent draw a decision the Factory makes: the inputs it reads, the questions a decision engine answers about them, the rule that combines the answers, the authority it answers to, and where the rulings on it are kept. It sits beside the machines (SMDF), the data (ERDF) and the scenarios (SQDF) of the same system.

**Desired Outcomes:**
1. A person or an agent writes one `.dmdf.json` file and reads it back as a decision requirements diagram
2. Which part of a decision a model answers, which part a rule combines, and which part a person rules is visible in the drawing, never left to a script
3. A decision engine's call (Jev's `{ state, questions }`) is generated from the document, so the drawing and the call cannot disagree
4. A decision whose outcome fires an event of a machine, or reads an entity, is checked against the drawings that define those names (Spec 82)
5. The rulings kept on a decision are named, so its bar can be set from them

## Why DMN, and what the loom adds

DMN's decision requirements diagram (DRD) is the standard drawing of a decision: a **Decision** (rectangle), **Input Data** (rounded), a **Business Knowledge Model** (clipped rectangle, a reusable piece of logic) and a **Knowledge Source** (document shape, an authority), joined by information, knowledge and authority requirements. Decision logic is a boxed expression, most often a decision table with a hit policy.

The loom keeps that vocabulary and adds one kind of logic DMN does not have: a **question** put to a decision engine, answered with a number (Jev's `noul`, `choice`, `score`, Episode 564 study part 1.3). It also adds **person** logic, a decision a seat or a person makes, so the drawing says where control moves back to a person (`miadi-foundation:delegation-and-adjustable-autonomy`, transfer of control). FEEL is not adopted: rules are written in words and evaluated by the code that owns the decision, as SQDF writes a fragment's condition.

## Core Concepts

### DecisionModelDefinition

```json
{
  "settings": { "namespace": "...", "name": "...", "description": "...", "notes": "...", "engine": "jev-1.14.0" },
  "inputs": [ { "name": "...", "description": "...", "entity": "..." } ],
  "knowledge": [ { "name": "...", "kind": "source | model | authority", "ref": "...", "description": "..." } ],
  "decisions": [ { "name": "...", "logic": { "kind": "question | table | person" }, "requires": ["..."], "knowledge": ["..."], "authority": ["..."], "outcomes": ["..."], "event": "...", "machine": "..." } ],
  "rulings": { "ledger": "...", "key": "decision_id", "bar_after": 20 }
}
```

### DmdInput (DMN Input Data)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique among inputs and decisions; what `requires` names |
| `description` | string | What the input holds. For an engine question, the key of the state it becomes |
| `entity` | string | An ERDF entity this input is (Spec 80), checked by the system |

### DmdKnowledge

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique among knowledge |
| `kind` | `"source"` \| `"model"` \| `"authority"` | `source`: a document the decision rests on (a study, a skill). `model`: logic reused by several decisions (DMN's business knowledge model), such as one question text shared by every caller. `authority`: who or what governs the decision whatever the number (DMN's authority requirement) |
| `ref` | string | A loom, chronicle, repository or file address |

### DmdDecision

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique among inputs and decisions |
| `logic.kind` | `"question"` | A question to the decision engine: `type` (`noul`, `choice`, `score`), `instructions`, `options` or `criteria` or `levels`, `rotate` (the options' order changes per call and is recorded, study jaggedness item 8) |
| `logic.kind` | `"table"` | Rules in words, `hit` (`first`, `unique`, `collect`), each `{ when, then }` |
| `logic.kind` | `"person"` | `who` decides: the seat, the person, a circle |
| `requires` | string[] | Inputs and other decisions this one reads (information requirements) |
| `knowledge` | string[] | `source` or `model` knowledge it uses |
| `authority` | string[] | `authority` knowledge that governs it |
| `outcomes` | string[] | What it can decide; a `choice` question's option keys by default |
| `event`, `machine` | string | The machine event an outcome fires, when the decision drives a behaviour (Spec 70, checked by Spec 82) |

### Rulings

`rulings.ledger` names the file where each call and each ruling are kept; `key` is the field joining them. `bar_after` is the count of rulings in one class after which a bar may be set (study S5). The loom reads the ledger to show each decision's calls and rulings beside it; it never writes it.

## Validation Rules

| Rule | Description |
|------|-------------|
| D001 | `settings.name` is present |
| D002 | Input and decision names are non-empty and unique together; knowledge names are unique |
| D003 | Every `requires` names an input or a decision; every `knowledge` names a `source` or `model`; every `authority` names an `authority` |
| D004 | The requirements form no cycle |
| D005 | A `question` has a `type` of `noul`, `choice` or `score`, and instructions; a `choice` has 2 to 255 options, a `score` 2 to 10 levels (Jev's limits) |
| D006 | A `table` has at least one rule, and every `then` is one of the decision's `outcomes` or a decision it requires |
| D007 | A question's instructions name, in backticks, only inputs it requires (`` `action` `` needs `action` in `requires`) |
| D008 | (system) An `event` exists in the named machine; an input's `entity` exists in a member ERD |

## File Format

**Canonical**: `.dmdf.json`. `isDecisionModelDefinition()` tells the shape apart: a decision model carries `decisions`, never `participants`, `entities` or a `state` tree.

## Rendering

`renderMermaidDecisions(def)` produces a Mermaid `flowchart BT`: a decision is a rectangle with its logic under its name, an input a stadium, a `model` a subroutine box, a `source` or `authority` an asymmetric box. Information is a solid arrow, knowledge a dotted arrow, authority a dotted line ending in a circle. `advance-gate.dmd.mmd` in Episode 564 is the hand-written first output.

## Engine Call

`toEngineRequest(def, values, model)` builds the decision engine's request from the document: `state` holds each input that a question requires, keyed by its name, and `questions` holds each `question` decision, keyed by its name. The caller evaluates `table` decisions in code and records `person` decisions as rulings. A caller written from the document (such as `advance-gate.mjs`) sends exactly what the drawing shows.

## MCP Tools (proposed)

**Build** — `create_decision_model`, `add_input`, `add_knowledge`, `add_decision`, `update_decision`, `remove_decision`, `add_requirement`, `remove_requirement`. **Check** — `validate_decision_model` (D001 to D007). **By extension** — `set_project_file`, `get_definition`, `render_diagram` (mermaid, to `<name>.dmd.mmd`) answer for a decision model when it is the active document. **Engine** — `decision_request` returns the request `toEngineRequest` builds, without sending it.

## Creative Advancement Scenarios

### Scenario: A Decision Made in a Script Becomes a Drawing
**Desired Outcome**: The person sees what a seat decides with Jev before it acts on its own
**Current Reality**: `advance-gate.mjs` holds seven questions and a band rule; its ledger holds its calls and their rulings; the person reads a README table
**Natural Progression**: The agent writes `advance-gate.dmdf.json`: four inputs, three knowledge, seven question decisions, the band table and the ruling decision; the loom draws it and validates it
**Resolution**: Episode 564 holds the drawing; the person asks on the canvas why `foreign_repo` reads `facts`, and the answer is J1 in the notes

### Scenario: A Decision Drives a Machine
**Desired Outcome**: A lane's state machine moves on a decision, and both drawings say so
**Current Reality**: lane-check's `lane_status` decides whether a lane is relayed, reopened or held (study S4); the lane's machine and the decision live in different files
**Natural Progression**: The decision's outcomes name the machine's events; the system check (D008) finds the one the machine lacks
**Resolution**: The replay of a scenario walks through the decision and the machine together

## Dependencies

- **Spec 70 (SMDF)**: the events an outcome fires
- **Spec 80 (ERDF)**: the entities an input is
- **Spec 82 (System)**: the document that joins a decision model to its siblings, and D008
- **Episode 564**: the Jev study, `advance-gate-261114/`, the first document

## Questions for Guillaume (Episode 121's format circle)

- Q1. The name: "decision model" and `.dmdf.json`, as this draft writes it, or DMN's own name (`.dmn.json`)?
- Q2. The first version: the requirements diagram with question, table and person logic, as here, or DMN decision tables evaluated by the loom as well?
- Q3. Does a decision model join a system (Spec 82) as a fourth member kind in the first version, or stand alone first?
- Q4. Do the Factory's Jev callers (advance-gate, choose-worker, lane-check, the proposal scorer, milestone routing) each publish their decision model, so each one's questions and band can be read and changed on the canvas?
