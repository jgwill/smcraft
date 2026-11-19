# DMDF — Decision Model Definition Format

> RISE Framework Specification
> References: Spec 70 (SMDF Format), Spec 80 (ERDF Format), Spec 81 (SQDF Format), Spec 82 (System Definition), Spec 83 (The Stage and the Marks); OMG Decision Model and Notation (DMN) 1.5

**Spec ID**: 85
**Version**: 0.2
**Status**: proposed, with a first working version. Its name, its extension and the questions at the end belong to Guillaume (Episode 121's format circle, Episode 564). It is not merged before he answers them.
**Implementation**: `bridge-protocol/src/decision/` (types, the rule language, validation, typed answers, the evaluator, the engine request, the ledger replay), `bridge-protocol/src/render/mermaidDecisions.ts`, `bridge-protocol/src/system/` (membership and D008), `mcp/src/decision.ts` (the tools). The canvas does not draw a decision model yet.
**First documents**: `examples/advance-gate/advance-gate.dmdf.json`, which is Episode 564's advance gate written to this version, with its ledger of 2026-11-14. The first drawing, written by hand to version 0.1, is kept beside it as `advance-gate.draft-0.1.dmdf.json`.
**Origin**: jgwill/smcraft#32. Guillaume, 2026-11-14: "I was really thinking about upgrading the factory to support a fourth new type of diagram, which is a decision model that is based on try to represent what you try to do when you use that decision engine to help you choose. So I would have a representation about the decision model ... I'm pretty sure there is a diagram type that enable us to actually represent decisions." Grounded in `miadi-foundation:decision-modelling-notations` (held by Episode 564). Version 0.2 takes what fits from a research report Guillaume sent the Factory on 2026-11-18 and from the Factory's assessment of it (both in Episode 564, `decision-diagram-report-261118/`).

## Creative Intent

**What DMDF Enables Users to Create:**
A declarative JSON document where a person and an agent draw a decision the Factory makes: the inputs it reads, the questions a decision engine answers about them, the table that combines the answers, the person who rules, the authority it answers to, and where the rulings on it are kept. It sits beside the machines (SMDF), the data (ERDF) and the scenarios (SQDF) of the same system.

**Desired Outcomes:**
1. A person or an agent writes one `.dmdf.json` file and reads it back as a decision requirements diagram
2. Which part of a decision an engine judges, which part a table decides, and which part a person rules is visible in the drawing, never left to a script
3. A decision engine's call is generated from the document, so the drawing and the call cannot disagree
4. A recorded run replays through the document with no call to an engine: the same snapshot and the same answers give the same outcome and the same rule trace in every caller
5. A decision whose outcome fires an event of a machine, or reads an entity, is checked against the drawings that define those names (Spec 82)
6. The rulings kept on a decision are counted against what they answered, so a person can set its bars from them

## Why DMN, and what the loom adds

DMN's decision requirements diagram (DRD) is the standard drawing of a decision: a **Decision** (rectangle), **Input Data** (rounded), a **Business Knowledge Model** (clipped rectangle, a reusable piece of logic) and a **Knowledge Source** (document shape, an authority), joined by information, knowledge and authority requirements. Decision logic is a boxed expression, most often a decision table with a hit policy.

The loom keeps that vocabulary and adds two kinds of logic DMN does not have:

- a **question** put to a decision engine, answered with a typed judgment (Jev's `noul`, `choice`, `score`, Episode 564 study part 1.3);
- a **person**, a decision that a seat or a person rules, so the drawing says where control moves back to a person (`miadi-foundation:delegation-and-adjustable-autonomy`, transfer of control).

Three boundaries follow, and the format holds each one mechanically:

1. **The engine makes judgments, a table makes the decision.** A question's answer is typed, and a rule reads it through that type. A rule that reads a judgment as one bare number is refused (D014).
2. **A person's ruling is a decision of its own, never a fallback.** Nothing computed produces it: no rule, no bar, no failure route. Until a ruling is recorded it is `awaiting_owner`, and whatever reads it waits with it.
3. **What is asked is kept apart from who answers.** The provider and its model are in `binding`. No question names them (D017).

FEEL is not adopted. A table's rules are written twice: in words, for the person who reads the drawing, and in a small rule language the loom runs. The format is DMN-inspired. It claims no DMN interchange.

## Core Concepts

### DecisionModelDefinition

```json
{
  "settings": { "namespace": "...", "name": "...", "description": "...", "notes": "...", "version": "0.1.0" },
  "binding": { "provider": "...", "model": "jev-1.14.0", "timeout_ms": 60000, "credentials": "JEV_AI_API_KEY" },
  "inputs": [ { "name": "...", "description": "...", "entity": "...", "type": "string | number | boolean" } ],
  "knowledge": [ { "name": "...", "kind": "source | model | authority", "ref": "...", "description": "..." } ],
  "groups": [ { "name": "...", "questions": ["..."], "description": "..." } ],
  "bars": [ { "name": "...", "value": 0.5, "set_by": "...", "calibrated_from": 0, "description": "..." } ],
  "decisions": [ { "name": "...", "logic": { "kind": "question | table | person" }, "requires": ["..."], "knowledge": ["..."], "authority": ["..."], "outcomes": ["..."], "machine": "...", "event": "...", "events": { "<outcome>": "<event>" } } ],
  "rulings": { "ledger": "...", "snapshot": "...", "key": "decision_id", "bar_after": 20, "decision": "...", "record": { } }
}
```

### Definition version — `settings.version`

Every document states its version (D012), and every run records it. A ruling is then always read against the rules it answered. The replay says so when a recorded run names another version than the document's.

### DmdInput (DMN Input Data)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique among inputs and decisions; what `requires` names |
| `description` | string | What the input holds. For an engine question, the key of the state it becomes |
| `entity` | string | An ERDF entity this input is (Spec 80), checked by the system (D008) |
| `type` | `"string"` \| `"number"` \| `"boolean"` | What a rule may do with it. Absent: the value is compared as it is given |

### DmdKnowledge

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique among knowledge |
| `kind` | `"source"` \| `"model"` \| `"authority"` | `source`: a document the decision rests on (a study, a skill). `model`: logic reused by several decisions (DMN's business knowledge model), such as one question text shared by every caller. `authority`: who or what governs the decision whatever the number (DMN's authority requirement) |
| `ref` | string | A loom, chronicle, repository or file address |

A knowledge entry is never executed and never asked. An engine is reached through a question, and nowhere else.

### DmdDecision

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique among inputs and decisions |
| `logic` | object | A question, a table or a person (below) |
| `requires` | string[] | Inputs and other decisions this one reads (information requirements). A rule reads only what its table requires |
| `knowledge` | string[] | `source` or `model` knowledge it uses |
| `authority` | string[] | `authority` knowledge that governs it |
| `outcomes` | string[] | What it can decide; a `choice` question's option keys by default |
| `machine` | string | `settings.name` of the machine its outcomes drive (Spec 70) |
| `event` | string | One event for every outcome; the outcome travels as its parameter |
| `events` | object | One event per outcome. Wins over `event` for the outcomes it names |

When a decision drives a machine, every outcome fires an event (D013), and each event exists in that machine (D008). A decision returns an event. It never moves a machine's state, and no engine is called inside a guard: the machine has a state in which it waits for the decision (`examples/decision-gate`: `Scoring`, then `Scored`).

### A question — `logic.kind: "question"`

| Field | Description |
|-------|-------------|
| `type` | `noul`, `choice` or `score` |
| `instructions` | The question. An input is named in backticks, and only one the decision requires (D007) |
| `criteria` | A noul's criterion: `{ "true": what makes it yes, "false": what makes it no }` |
| `criteria_from` | A noul's criterion when it arrives with the run: an input the decision requires and names (an acceptance line) |
| `options` | A choice's options, each with what makes it the one. 2 to 255. A choice decides one of its options: when it also writes `outcomes`, they are the same names |
| `levels` | A score's levels, lowest first. 2 to 10 |
| `rotate` | The options' order changes per call and the order used is recorded (study jaggedness item 8). Options that rotate are named with words: a JSON object written by JavaScript puts a key that is a whole number first, so `"1"`, `"2"`, `"3"` can be sent in one order only (D005) |

**Every question states its criterion, a noul included** (D009). The Factory measured why twice: without its acceptance line, "is it done" came back 83.3% unclassifiable, and on 2026-11-15 a judge's question without its criterion read 0.18 to 0.57 on five moments.

### Typed answers

Each question type has its own answer, read in the engine's own shape so a recorded response replays as it was received.

| Type | The engine's answer | What a rule reads |
|------|---------------------|-------------------|
| `noul` | `{ type, noul }` | `<name>.yes`: the probability that the proposition is true. 0.5 is "cannot tell", not "half as much". It has no confidence of its own |
| `choice` | `{ type, choice, confidence, probabilities }` | `.choice`, `.confidence` (how peaked the distribution is), `.probabilities.<option>`, `.top` (the highest probability), `.margin` (the highest minus the next) |
| `score` | `{ type, score, confidence, probabilities }` | `.score` (a position on the levels, which may fall between two), `.confidence`, `.probabilities["<level index>"]` |

A decision's bare name is never a value. `deletes >= 0.5` is refused, and the message says to read `deletes.yes`. An answer that breaks its contract (a probability outside 0 to 1, a distribution that does not cover the declared options or sum to one within 0.025, an option that was not declared) is `invalid`, and no number is read from it. A constrained answer is a well-formed answer. It is not thereby a true one.

### A question group — `groups`

The questions of one group go to the engine in **one request**: they see the same snapshot and each is answered without the others. A group is drawn as a box around its questions.

A group is never a dependency. A question that needs another's answer `requires` it, which is an arrow, and the two are then two requests (D010). Questions that no group names are grouped by the loom: those that wait on no other question share one request named `default`, and each question that needs an answer is a request of its own, named after it. A group the document writes takes neither of those names (D010). Answering together is not statistical independence: two questions of one group may be about related facts.

### A table — `logic.kind: "table"`

```json
{ "kind": "table", "hit": "first",
  "rules": [
    { "when": "any of the six triggers >= 0.5", "if": "max(deletes.yes, credential.yes) >= owner_at", "then": "hold_for_person" },
    { "when": "the choice is sure enough", "if": "answered(advance) and advance.confidence >= advance_at", "from": "advance" },
    { "when": "otherwise", "if": "otherwise", "then": "seat_reads" }
  ],
  "failure": { "then": "hold_for_person", "description": "..." } }
```

| Field | Description |
|-------|-------------|
| `hit` | **Stated on every table** (D011). `first`: the first rule that holds. `unique`: exactly one may hold, and two holding together is a conflict with no outcome. `collect`: every rule that holds, in order |
| `rules[].when` | The rule in words |
| `rules[].if` | The same rule in the rule language. Without it the loom draws the rule and does not run it (D020) |
| `rules[].then` | The outcome, one of the decision's `outcomes` |
| `rules[].from` | In place of `then`: a required decision whose own value is the outcome (a choice question's option, a table's outcome, a ruling). Every value it can give is one of this table's outcomes (D006) |
| `failure.then` | The failure route |

`from` exists because of the first document. Its rule 3 gave "the advance choice", while `advance` was both a decision and one of the table's outcomes. A `then` that may mean either is now two fields.

### The rule language

Bounded on purpose. A rule is parsed into a tree and the tree is walked. Nothing is handed to `eval`, and a name is only ever looked up in what the document declares.

```
rule     := "otherwise" | or
or       := and ( "or" and )*
and      := not ( "and" not )*
not      := "not" not | compare
compare  := sum [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) sum | "in" interval ]
interval := ( "[" | "(" ) sum "," sum ( "]" | ")" )        [0.4, 0.6) holds 0.4 and not 0.6
sum      := product ( ( "+" | "-" ) product )*
product  := unary ( ( "*" | "/" ) unary )*
unary    := "-" unary | primary
primary  := number | string | "true" | "false" | call | ref | "(" or ")"
call     := ( "max" | "min" | "answered" | "collected" ) "(" or ( "," or )* ")"
ref      := name ( "." name | "[" string "]" )*
```

A reference names an input, a bar, or one field of a required decision. `answered(q)` says whether a question has a valid answer, so a missing answer is told apart from a negative one. It asks about a question only: whether a person has ruled is never a rule's to route around. `collected(t, "x")` asks a `collect` table. `and` and `or` stop at the first operand that settles them. A rule is at most 2000 characters and nests at most 32 deep, the rule itself being the first level. Before any run, D014 checks that each rule parses, reads only what its table requires, and compares like with like.

### The failure route — `logic.failure`

A table that reads an engine's answers says where it goes when the engine fails, times out, or breaks its contract (D015). When a rule reads a question that has no valid answer, the table is `failed` and its outcome is `failure.then` (for a `collect` table, the one outcome it then holds). The outcome is one of the table's own, so a machine it drives receives it like any other (D013). Without a declared route a failed table has no outcome, and nothing is assumed in its place.

The failure route is for an engine. A table that requires a decision still awaiting its owner never takes it: see the person, below.

### A person — `logic.kind: "person"`

| Field | Description |
|-------|-------------|
| `who` | Who rules: the seat, a named person, a circle |
| `description` | What they rule on, and how it is recorded |

A person's decision lists the `outcomes` that can be ruled (D016). Its result is `awaiting_owner` until a ruling is recorded for it, and then `ruled`, with who ruled and their words, which are never edited. It carries no rule, no bar and no failure route (D016). `toEngineRequest` never sends a person's decision. An event mapped from its outcome fires only from a recorded ruling.

**Waiting is not failing.** A table that reads an unruled person's decision is `awaiting_owner` too. And while a table requires any decision that still awaits its owner, a missing answer never sends it to its failure route, whichever of the two a rule reads first and whatever its hit policy: it waits, and says what it waits on and which answer is missing. Once the person has ruled, an engine's failure is the table's to route. A rule that holds before either is read still decides, as its place in the table says.

### Bars — `bars`

A bar is a threshold a rule reads by name. It is a choice someone made: `set_by` names them, and `calibrated_from` counts the rulings the value was checked against.

**How a bar moves.** A person moves it, never the loom.

1. Each ruling is kept in the ledger beside the run it answers.
2. The replay counts the rulings in force (per run and person's decision, the last that still stands and can stand) and compares each with what the replay gives for the decisions it answered: the table's outcome and the engine's choice. Under the document's own bars, that is what the ruling answered.
3. When `rulings.bar_after` rulings stand, a person may set a bar. Before that the count is shown as not reached.
4. A candidate value is tried on the recorded answers (`bars` on `simulate_decision` and `replay_decision_ledger`): the replay says which recorded runs would then decide differently. The document is not changed by a trial.
5. The person writes the new `value` with `set_by` and `calibrated_from`, and raises `settings.version`. Runs recorded under the earlier version keep it.

Steps 1 to 4 are implemented. Step 5 is an edit of the document by a person or at their word. The loom has no tool that sets a bar.

### The binding — `binding`

`provider`, `model`, `timeout_ms`, and `credentials`, which is the **name** of the environment variable that holds the key. A key is never written in a document (D017). A caller may pass another model to `toEngineRequest`, and nothing that is asked changes. Version 0.1 wrote the model as `settings.engine`. It is still read when there is no `binding`, with a warning.

### Rulings and the ledger — `rulings`

`rulings.ledger` names the file where each run and each ruling are kept, `snapshot` a copy beside the document, `key` the field of a ruling that names its run, `decision` the person's decision the rulings are the outcome of, `bar_after` the count after which a person may set a bar (study S5). The loom reads the ledger. It never writes it.

A line of the ledger, in the format's own shape:

```json
{ "kind": "decision", "id": "…", "at": "…", "definition": { "name": "…", "version": "…" }, "values": { }, "answers": { }, "outcomes": { "band": "hold_for_person" } }
{ "kind": "ruling", "decision_id": "…", "decision": "ruling", "outcome": "advance", "decided_by": "…", "words": "…", "at": "…" }
{ "kind": "ruling_withdrawn", "decision_id": "…", "withdrawn_ruling_at": "…" }
```

`answers` holds each question's answer as the engine gave it. A ledger written before this shape is read through `rulings.record`, which gives the dot-separated path of each value, each answer field, each recorded outcome and the version inside a line (`"deletes": { "noul": "triggers.deletes" }`).

A ruling counts when it can stand: it names a run the ledger holds and a person's decision of the model, it rules one of that decision's outcomes, and it says who ruled. A ruling that cannot stand, and a withdrawal that finds no ruling, are reported with their line and never counted. When a model has several person's decisions, each ruling line names its own in `decision`, and `rulings.decision` is the one counted against `bar_after`.

## Validation Rules

An issue is an error unless marked as a warning. A warning is a document the loom reads and draws, and does less with.

A document written in the wrong shape (a list where a map belongs, an entry that is not an object, a path that is not text) is reported under the rule that owns the field, and the rest of it is still checked. No reader of a decision model throws on a document, whatever it holds: the validator, the evaluator, the drawing, the request and the replay all read it through `safeModel`.

A name every JavaScript object already carries (`constructor`, `toString`, `__proto__` and the like) is refused for an input, a decision, a knowledge, a bar, a group, an option and an outcome, under the rule of each. A model has at most 500 decisions (D002). Past that it is refused whole and not run.

| Rule | Description |
|------|-------------|
| D001 | `settings.name` is present |
| D002 | Input and decision names are non-empty and unique together; knowledge names are unique, with a known kind |
| D003 | Every `requires` names an input or a decision; every `knowledge` names a `source` or `model`; every `authority` names an `authority` |
| D004 | The requirements form no cycle |
| D005 | A decision's logic is a question, a table or a person. A question has a `type` of `noul`, `choice` or `score`, and instructions; a `choice` has 2 to 255 options, a `score` 2 to 10 levels. A choice's `outcomes`, when written, are its options. A choice that rotates names no option with a whole number |
| D006 | A table lists its outcomes and has at least one rule. Each rule has a `when`, and one of `then` (one of the outcomes) or `from` (a required decision, all of whose values are among the outcomes) |
| D007 | A question's text names, in backticks, only inputs it requires (`` `action` `` needs `action` in `requires`) |
| D008 | (system) A decision's `machine` is a member machine, each event an outcome fires exists in it, and an input's `entity` exists in a member ERD |
| D009 | Every question states its criterion: a noul in `criteria.true`, or in a required input named by `criteria_from` and by its instructions; a choice on every option; a score on every level |
| D010 | A group names questions of the model, a question is in one group at most, and no question of a group needs the answer of another. A group is not named `default` or after a decision |
| D011 | A table states its hit policy: `first`, `unique` or `collect` |
| D012 | `settings.version` is present |
| D013 | When a decision drives a machine, `events` names only its outcomes, and every outcome has an event |
| D014 | A rule's `if` parses in the rule language, reads only what its table requires and the bars, reads a judgment through its type, and compares like with like |
| D015 | A table that requires a question declares a failure route, and `failure.then` is one of its outcomes |
| D016 | A person's decision names `who`, lists its outcomes, and carries no rule, no hit policy and no failure route |
| D017 | `binding` is well formed and its `credentials` is a variable name; no decision's logic names a provider or a model. Warning: `settings.engine` is version 0.1's place for the model |
| D018 | Bar names are unique, are not the name of an input, a decision or a word of the rule language, and each has a number |
| D019 | Warning: a `first` table with no `otherwise` rule, or with one before its last rule; a `unique` table with an `otherwise` rule |
| D020 | Warning: a table with a rule written in words only (`when` without `if`). The loom draws it and does not run it |
| D021 | Warning: a question whose answer no decision requires |
| D022 | `rulings.bar_after` is a whole number of 1 or more, `rulings.decision` names a person's decision, and `rulings.record` names inputs, questions and decisions of the model, with every field of each answer, each as a path in text |

## Evaluation — `evaluateDecisions(def, { values, answers, rulings, bars })`

One run from recorded answers. It asks no engine and reads no clock. It returns the definition and its version, the bars the run was read against, and one result per decision, each after what it requires:

| A decision | Can be |
|------------|--------|
| question | `answered` (with its typed answer), `missing`, `invalid` (with why) |
| table | `decided` (its outcome, the rule that decided it), `failed` (its failure route, the questions that had no answer), `awaiting_owner` (what it waits on, and any answer missing as well), or no outcome with the reason: `no_rule`, `conflict`, `error`, `not_evaluable` |
| person | `awaiting_owner` (with `who`), `ruled` (the outcome, who ruled, their words) |

A table's result carries its **rule trace**: each rule tried, in order, whether it held, and every value it read, keyed as the rule wrote it (`"foreign_repo.yes": 0.47`, `"owner_at": 0.5`). An explanation of a run is this trace, read aloud. It is never a story about what the engine thought.

**The acceptance test of the format**: given a fixed input snapshot and fixed answers, every caller produces the same outcome and rule trace. Every caller uses this one function. The protocol's tests and the MCP's tests compare their results as data.

## Engine Call — `toEngineRequest(def, values, options)`

Builds one request, and sends nothing. `state` holds what the questions of one group require, keyed by name, in the document's order. `questions` holds those questions, each with its type, its instructions and its criteria (a noul's `{ true, false }`, a choice's options in the order sent, a score's levels). `options.group` names the request, `options.rotation` turns the options of each question that rotates, `options.optionOrder` gives a recorded order instead, and `options.model` overrides the binding. A value the request needs and does not have is an error: it is not sent as an empty one. A question that waits on another decision finds that decision's result in `values`, like an input.

A provider adapter (sending the request, checking and recording the response) is not part of this version.

## The ledger replay — `replayLedger(def, lines, { bars })`

Runs every recorded run through the document again, from the answers its line holds, and says for each whether the tables give the outcome the line recorded, with the rule that decided it and the rulings in force. A line that lacks something a table reads is **not replayable**, and the report names the field. An answer no table reads may be absent. A key that is absent is a ledger that never kept it. A `null` is an engine that never answered: that is a recorded fact, and it replays through the failure route.

On Episode 564's ledger of 2026-11-14 (16 lines: 7 runs, 8 rulings, 1 withdrawal), the 7 runs replay to their recorded bands: `hold_for_person` by rule 1 five times, by rule 2 once, and `seat_reads` by rule 4 once. Seven rulings are in force. One ruled as the band did and six ruled against it. Twenty are needed before a bar may be set.

## Rendering — `renderMermaidDecisions(def)`

A Mermaid `flowchart BT`: an input is a stadium, a decision a rectangle with its logic under its name, a `model` a subroutine box, a `source` or `authority` an asymmetric box. Information is a solid arrow, knowledge a dotted arrow, authority a dotted line ending in a circle. The three kinds of logic are told apart by their border as well as their words, never by colour: a question is dashed, a table plain, a person's decision heavy. A group the document writes is a box around its questions, and never an arrow. `render_diagram` writes it as `<name>.dmd.mmd`.

## In a system (Spec 82)

A decision model stands alone: every tool above works on one document. It is also a member kind a system admits. `checkSystem` then reports its own rules with the system's, and D008 for the names that cross. Membership is one entry in `MEMBER_KINDS`. Taking it out is the whole of making a decision model stand alone only, which is how Q3 below stays open.

Not yet in a system: links as data for a decision's elements, a scenario message that invokes a decision, and a replay that walks a decision and a machine together.

## MCP Tools

**Check** — `validate_decision_model` (D001 to D007, D009 to D022). **Engine** — `decision_request` returns the request `toEngineRequest` builds, and sends nothing. **Run** — `simulate_decision` runs the model from recorded answers; `replay_decision_ledger` replays a ledger. **By extension** — `set_project_file`, `get_project_file`, `get_definition`, `load_definition`, `render_diagram`, `get_notes` and `set_notes` answer for a decision model when it is the active document. **In a system** — `add_member` takes a `.dmdf.json`, and `check_system` reports D008.

Proposed in 0.1 and not built: `create_decision_model`, `add_input`, `add_knowledge`, `add_decision`, `update_decision`, `remove_decision`, `add_requirement`, `remove_requirement`. A model is written whole with `load_definition`.

## From 0.1 to 0.2

A document written to 0.1 is still read and drawn. It is not valid, and its table is not run. What it needs:

| 0.1 | 0.2 |
|-----|-----|
| no version | `settings.version` (D012) |
| `settings.engine` | `binding.model` (D017, warning) |
| a noul with instructions only | its `criteria` (D009) |
| rules in words (`when`) | the same rule beside it in the rule language (`if`), and thresholds as `bars` |
| `then` naming an outcome or "the choice of a decision" | `then` for an outcome, `from` for a decision |
| a table that reads answers | its `failure` route (D015) |
| one request, unstated | a `groups` entry |
| a ledger read by its script | `rulings.record`, or lines in the format's own shape |

The first document showed two more things. Its drawing and its script had different option texts for the `advance` choice, which is what a generated request ends (Desired Outcome 3). And its nouls had criteria in the script (the kit's `TRIGGERS`) that the drawing did not show.

## Creative Advancement Scenarios

### Scenario: A Decision Made in a Script Becomes a Drawing
**Desired Outcome**: The person sees what a seat decides with an engine before it acts on its own
**Current Reality**: `advance-gate.mjs` holds seven questions and a band rule; its ledger holds its calls and their rulings; the person reads a README table
**Natural Progression**: The agent writes `advance-gate.dmdf.json`: four inputs, three knowledge, seven questions in one group, four bars, the band table and the ruling; the loom validates it and draws it
**Resolution**: Episode 564 holds the drawing; the person asks why `foreign_repo` reads `facts`, and the answer is J1 in the notes

### Scenario: A Recorded Run Is Replayed
**Desired Outcome**: A person reads why a past run was held, without paying for a new one
**Current Reality**: The ledger holds the engine's answers of 2026-11-14 and the band each run was given
**Natural Progression**: `replay_decision_ledger` runs each line through the table; the fifth run shows rule 1 not holding and rule 2 holding on `foreign_repo.yes` 0.47
**Resolution**: The person sees that the uncertain band, not the owner's bar, held that run, and tries `uncertain_from` at another value on the same answers

### Scenario: A Decision Drives a Machine
**Desired Outcome**: A lane's state machine moves on a decision, and both drawings say so
**Current Reality**: lane-check's `lane_status` decides whether a lane is relayed, reopened or held (study S4); the lane's machine and the decision live in different files
**Natural Progression**: The decision's outcomes name the machine's events; the system check (D008) finds the one the machine lacks
**Resolution**: The machine waits in one state for the decision's event, and no engine is called inside a guard

## Dependencies

- **Spec 70 (SMDF)**: the events an outcome fires
- **Spec 80 (ERDF)**: the entities an input is
- **Spec 82 (System)**: the document that joins a decision model to its siblings, and D008
- **Episode 564**: the Jev study, `advance-gate-261114/`, the first document and its ledger

## Not in this version

- A provider adapter, and any call to an engine
- A canvas for a decision model: the designer shows a notice for a `.dmdf.json`
- The build tools of 0.1 (a model is loaded whole)
- A tool that sets a bar
- A scenario (SQDF) that invokes a decision, and a system replay through decisions
- Influence diagrams (utility, expected consequences): a later capability
- Comparing two versions of a definition

## Questions for Guillaume (Episode 121's format circle)

- Q1. The name: "decision model" and `.dmdf.json`, as this draft writes it, or DMN's own name (`.dmn.json`), or the report's `.ddf.json`? Two documents and this implementation use `.dmdf.json`.
- Q2. The first version: the requirements diagram with question, table and person logic, as here, where the loom now runs a table written in its rule language. Is that the scope, or DMN decision tables in DMN's own form as well?
- Q3. Does a decision model join a system (Spec 82) as a member kind in the first version, or stand alone first? Both work today, and membership is one entry in `MEMBER_KINDS`.
- Q4. Do the Factory's engine callers (advance-gate, choose-worker, lane-check, the proposal scorer, milestone routing) each publish their decision model, so each one's questions and band can be read and changed from the document?
- Q5. Episode 564's `advance-gate.dmdf.json` and the staged `episode-birth.dmdf.json` are written to 0.1. Are they replaced by their 0.2 form, and by whom? `examples/advance-gate/` holds the first one's.
- Q6. `tandt`, the fourth question kind of `examples/decision-gate` (a Digital Decision Making model: one acceptable or unacceptable element per row, ranked by dominance). A new question type, or a group of nouls with a first-hit table, which the format already draws?
- Q7. Do the callers write the ledger in the format's own line shape from now on (the engine's answers as given, the definition version), so no `record` map is needed for new ledgers?
