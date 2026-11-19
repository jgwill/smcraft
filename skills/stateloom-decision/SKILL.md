---
name: stateloom-decision
description: Write, check, draw and replay a decision model through the stateloom MCP tools, as a .dmdf.json beside a system's state machines, ERD and scenarios. Use when creating or editing a .dmdf.json, calling validate_decision_model, decision_request, simulate_decision or replay_decision_ledger, drawing what a decision engine (Jev) is asked and what a table decides from its answers, writing a question with its criterion (noul, choice, score), a question group, a decision table with its hit policy and its rules in the rule language, bars, a failure route or a person's ruling, fixing D001-D022 errors, replaying recorded answers or a ledger without calling an engine, trying another bar on recorded runs, or joining a decision model to a system (D008).
---

# A decision model through the MCP tools

A decision model here is a `.dmdf.json` document: **DMDF**, the loom's fourth drawing beside
SMDF (behaviour), ERDF (data) and SQDF (scenarios). It says how a decision is made: what it
reads, what a decision engine is asked, the table that combines the answers, and the person
who rules.

Full specification: `rispecs/85-dmdf-decision-model.spec.md` in `jgwill/smcraft`. A worked
example with a real ledger: `examples/advance-gate/`.

Three boundaries hold everywhere, and the tools enforce them:

1. **The engine makes judgments, a table makes the decision.** Never write a rule that reads
   a judgment as one bare number.
2. **A person's ruling is a decision of its own.** Nothing computed produces it or stands in
   for it. Until it is recorded, it is `awaiting_owner`.
3. **What is asked is apart from who answers.** The provider and its model go in `binding`.

No tool here calls an engine. A call costs paid tokens and is a person's decision.

---

## Step 0 — The active document's type is its extension

`.smdf.json` machine, `.erdf.json` ERD, `.sqdf.json` sequence, `.sysdf.json` system,
`.dmdf.json` decision model. The decision tools act while the active document is a
`.dmdf.json`. A model is written whole:

```
set_project_file  { "path": "/abs/diagrams/refund.dmdf.json" }
load_definition   { "json": "<the whole document>" }
validate_decision_model
```

`load_definition` reports the D rules at once. Read `get_notes` before changing a model
somebody else has been working on.

---

## The tools

| Group | Tools |
|---|---|
| Read and write | `get_definition()`, `load_definition(json)`, `get_notes()`, `set_notes(target?, notes)` (target: an input, a knowledge or a decision) |
| Check | `validate_decision_model()`; in a system, `check_system` adds D008 |
| Draw | `render_diagram()` writes `<name>.dmd.mmd` (Mermaid; svg and png are not drawn yet) |
| Ask (nothing is sent) | `decision_request(values, group?, model?, rotation?, option_order?)` |
| Run from recorded answers | `simulate_decision(answers, values?, rulings?, bars?)`, `replay_decision_ledger(ledger?, bars?, json?)` |

---

## Writing the document

```json
{
  "settings": { "namespace": "shop", "name": "Refund", "version": "1.0.0" },
  "binding": { "model": "jev-1.14.0", "credentials": "JEV_AI_API_KEY" },
  "inputs": [ { "name": "message" }, { "name": "amount", "type": "number" } ],
  "knowledge": [ { "name": "Manager", "kind": "authority" } ],
  "bars": [ { "name": "sure_at", "value": 0.8 } ],
  "decisions": [ ... ]
}
```

`settings.version` is required: every run records it. `binding.credentials` is the **name**
of an environment variable. Never write a key in a document.

### A question

```json
{ "name": "asks_refund",
  "logic": { "kind": "question", "type": "noul",
             "instructions": "Does `message` ask for a refund?",
             "criteria": { "true": "It asks for money back.", "false": "It asks for something else." } },
  "requires": ["message"] }
```

- **Every question states its criterion** (D009): a noul in `criteria.true`, a choice on each
  option, a score on each level. A question without one reads unreliably. When the criterion
  arrives with the run (an acceptance line), name the input in `criteria_from` and in the
  instructions.
- An input is named in backticks, and only one the decision `requires` (D007).
- `type` is `noul` (is this true?), `choice` (`options`, 2 to 255) or `score` (`levels`,
  2 to 10, lowest first). Name a choice's options with words, never with numbers: options
  named `"1"`, `"2"` cannot be sent in another order.
- Do not name anything `constructor`, `toString` or another name every JavaScript object
  carries, and do not name a group `default` or after a question.

### What a rule reads from an answer

| Type | Fields |
|---|---|
| noul | `name.yes` — the probability of yes. 0.5 means "cannot tell" |
| choice | `name.choice`, `name.confidence`, `name.probabilities.<option>`, `name.top`, `name.margin` |
| score | `name.score`, `name.confidence`, `name.probabilities["0"]` |
| table | `name.outcome` (a `collect` table: `collected(name, "x")`, `name.count`) |
| person | `name.outcome`, once ruled |

A bare `name >= 0.5` is refused: say which reading you mean.

### A group — one request

```json
"groups": [ { "name": "desk", "questions": ["asks_refund", "category"] } ]
```

The questions of a group see the same snapshot and are answered without each other. If one
question needs another's answer, that is a `requires` arrow and two requests, never one
group (D010).

### A table

```json
{ "name": "handling",
  "logic": { "kind": "table", "hit": "first",
    "rules": [
      { "when": "a refund is asked for, surely, and it is small",
        "if": "asks_refund.yes >= sure_at and amount <= 25", "then": "refund" },
      { "when": "the category decides", "if": "answered(category) and category.confidence >= 0.6", "from": "category" },
      { "when": "otherwise", "if": "otherwise", "then": "respond" } ],
    "failure": { "then": "review" } },
  "requires": ["asks_refund", "category", "amount"],
  "outcomes": ["refund", "respond", "review", "billing", "delivery", "other"] }
```

- **Always state `hit`**: `first`, `unique` or `collect`.
- Write each rule twice: `when` in words for the person, `if` in the rule language for the
  loom. A rule with no `if` is drawn and not run.
- `then` is one of the table's outcomes. `from` takes the outcome from a required decision
  (the option a choice picked).
- **`failure.then`** says where the table goes when the engine fails or times out (D015).
- A rule reads only what the table `requires`, and the bars.

### The rule language

`and`, `or`, `not`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, parentheses,
`x in [0.4, 0.6)` (closed at `[`, open at `)`), `max(...)`, `min(...)`, `answered(question)`,
`collected(table, "outcome")`, and `otherwise` alone. Nothing else. Put a threshold in `bars`
and read it by name, so a person can find it and try another value.

### A person

```json
{ "name": "sign_off", "logic": { "kind": "person", "who": "the desk manager" },
  "requires": ["handling"], "authority": ["Manager"], "outcomes": ["approve", "refuse"] }
```

Never give a person's decision a rule, a bar or a failure route (D016). If an outcome is a
named person's to give, draw it as a person, not as a "review" outcome of a table. A table
that requires a person who has not ruled waits with them: its failure route never fires in
their place.

---

## Running without an engine

```
simulate_decision {
  "values":  { "amount": 40 },
  "answers": { "asks_refund": { "type": "noul", "noul": 0.91 },
               "category": { "type": "choice", "choice": "billing", "confidence": 0.7,
                             "probabilities": { "billing": 0.8, "delivery": 0.1, "other": 0.1 } } }
}
```

The answer is the run as text and as JSON: for each table its outcome, the rule that decided
it and what each rule read. Explain a run by reading that trace. Never invent a reason the
engine "had".

- A question with no answer is `missing`, and the tables that read it go to their failure
  route.
- A person's decision is `awaiting_owner` unless `rulings` gives one, with `by` (who ruled)
  and their `words`, verbatim.
- `bars` tries other values. It never changes the document.

`replay_decision_ledger` runs every recorded run of a ledger through the model and says
whether each gives the outcome it recorded. A line that lacks a field a table reads is
reported as not replayable, with the field. It also counts the rulings in force against
`rulings.bar_after` and how many agree with what the replay gives. A ruling that names no
run, rules nothing or does not say who ruled is reported and not counted. Use it before
proposing a bar, and after changing a rule.

---

## The request to the engine

`decision_request` returns what the model would send, and sends nothing: `state` (the inputs
the group's questions require) and `questions` (type, instructions, criteria). Read it with
the person before any caller sends it. `rotation` turns the options of a question that has
`rotate: true`: pass the count of earlier runs, and record the order sent.

---

## In a system

```
add_member   { "path": "refund.dmdf.json" }     (active document: the .sysdf.json)
check_system
```

When a decision drives a machine, give `machine` and either `event` (one event, the outcome
as its parameter) or `events` (one per outcome). D008 checks that each event exists in that
machine and that an input's `entity` exists in a member ERD. Give the machine a state in
which it waits for the decision's event. Never put an engine call inside a guard.

---

## The rules, briefly

| Rule | Says |
|---|---|
| D001, D012 | a name and a version |
| D002 to D004 | unique names, requirements that exist, no cycle |
| D005, D009 | a question's type, instructions and criterion |
| D006, D011, D014, D015 | a table's rules, hit policy, rule language and failure route |
| D007 | backticks name only required inputs |
| D010 | a group is one request |
| D013, D008 | every outcome of a driving decision fires an event that exists |
| D016 | a person's decision is only a ruling |
| D017, D018 | the binding kept apart, the bars |
| D019 to D021 | warnings: an uncovered table, a table in words only, an unread answer |
| D022 | the rulings and how a ledger line is read |

---

## What the loom never does

- It never calls an engine.
- It never sets a bar. A person does, after reading the replay.
- It never computes a ruling, and never edits a person's words.
- It never completes a ledger: a field that is absent is reported, not filled.
