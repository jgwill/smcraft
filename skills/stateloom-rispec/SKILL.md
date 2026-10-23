---
name: stateloom-rispec
description: Generate a RISE rispec — a markdown specification — from a stateloom / smcraft state machine. Use when calling the generate_rispec MCP tool or the web designer's RISE button, turning a .smdf.json into a Reverse-Engineering / Intent / Specifications / Exportation document, passing an intent to state the desired outcome, folding a PDE decomposition (settings._source.pdeId and pdeFolder) into the spec, or writing the resulting rispec to a file for review or handoff.
---

# SMDF → RISE rispec

A state machine is a design. A rispec is that design stated as prose someone can review,
argue with, and hand on — the **E**xportation step of RISE that is neither source code nor raw
JSON.

```
PDE (optional)          .smdf.json                  <name>.rispec.md
decomposition  ───────► the machine     ───────►    R · I · S · E
 prompt, directions,     states, events,             the spec a human reads
 action stack,           transitions
 ambiguities
```

The generator is deterministic: same machine, same intent, same document. It reads and never
writes — **the tool returns markdown as text; putting it in a file is your job.**

---

## The tool

```
generate_rispec { "intent": "…" }      // intent is optional
```

It operates on the **active project document**. Confirm which one before you generate:

```
get_project_file
→ Active document: /abs/path/machine.smdf.json
```

With no machine at that path it returns an error result: `No state machine at <path>.`

---

## Step 1 — Decide the intent

`intent` sets the tagline, the **Desired Outcome**, and the *Desired* half of the structural
tension. It is the one thing the machine cannot tell you about itself.

Precedence, in order — the first that exists wins:

| Source | Where it comes from |
|---|---|
| `intent` argument | You pass it in the call |
| `settings._source.pdeFolder` → PDE `result.primary.target` | The originating prompt decomposition |
| `settings._source.originalPrompt` | Recorded on the SMDF itself |
| `"<Name> state machine"` | The fallback |

Without any of them the Desired Outcome renders as
`_(no intent supplied — pass \`intent\` arg or set _source.originalPrompt)_`, which is a
placeholder, not a specification. Supply an intent.

Write it as an outcome, not a task. `"Orders reach fulfilment or a stated refusal, and never
sit in an undefined state"` specifies something. `"Refactor the order code"` does not.

---

## Step 2 — Generate

```
generate_rispec { "intent": "Orders reach fulfilment or a stated refusal, and never sit in an undefined state" }
```

The returned document, in order:

```markdown
# OrderWorkflow — RISE rispec

> Orders reach fulfilment or a stated refusal, and never sit in an undefined state

**Namespace:** `Orders` · **Async:** false
**Source PDE:** `a6582030-…`            ← only when _source.pdeId is present

---

## R — Reverse Engineering

OrderWorkflow is modeled as a state machine with 6 non-root states across 1 level(s) of
composition. Events: 4. Transitions: 7.

Originating prompt:                     ← only when the PDE carries one
> …

## I — Intent

**Desired Outcome**
…

**Vision (🌅 East)**                     ← only when the PDE has east directions
- …

**Structural Tension**
- *Current:* …
- *Desired:* …

## S — Specifications

### States                              ← nested bullets, kind in italics, one line per transition
- **Pending** — Awaiting approval
  - on `OrderApproved` → `Active`
- **Completed** *(final)*

### Events                              ← grouped by event source
**Internal**
- `OrderApproved` — description

### Transitions (flat)
- `Pending` --[OrderApproved]-- → Active

### Action Steps                        ← only when the machine walks the directions, or the PDE has an action stack

### Open Questions                      ← only when the PDE carries ambiguities

## E — Exportation
- Code: `generate_code` (python | typescript) — runtime stubs from this SMDF
- Visual: open this file in the stateloom web designer with `STATELOOM_PROJECT_FILE=…`
- SMDF: `get_definition` returns the canonical JSON
```

### What the generator infers on its own

- **Counts** — non-root states, levels of composition, events, transitions.
- **Current reality** — read off the shape. A machine with a `final` state renders as
  *"designed but not implemented; entry state defined, terminal state reachable in principle."*
  One without renders as *"partially modeled; no terminal state declared yet."* Adding a
  terminal state changes the sentence, which is the point: the spec tracks the design.
- **Every transition twice** — nested under its state, and again flat. The nesting shows
  structure; the flat list is what you diff between versions.

---

## Step 3 — Write it down

The tool hands back text. Save it beside the machine:

```bash
# from the agent: take the returned markdown and write it
/abs/path/diagrams/order-workflow.rispec.md
```

Naming that stays legible: `<machine>.rispec.md` next to `<machine>.smdf.json`, or into the
project's `rispecs/` directory if one exists. Regenerate rather than hand-edit — the machine
is the source, the rispec is the export. Anything you write into the markdown is lost on the
next generation; anything you want kept belongs in the SMDF as a `description`.

**Descriptions are what make a rispec readable.** Every `description` on a state, an event or
a transition lands in the document verbatim. A machine designed without them produces a
structurally correct spec that says nothing. Fill them in first, generate second.

---

## The PDE-sourced path

When a machine was born from a prompt decomposition, record the provenance on the SMDF and the
rispec folds the decomposition back in.

```json
"settings": {
  "namespace": "Miaco.Ceremony",
  "name": "CliWatcherPDE",
  "asynchronous": false,
  "_source": {
    "kind": "miaco-pde",
    "pdeId": "a6582030-15cc-4896-9d6a-962d9c8d252a",
    "pdeFolder": ".pde/2604161300--a6582030-15cc-4896-9d6a-962d9c8d252a/",
    "originalPrompt": "Build a small CLI that watches a directory and notifies via webhook when a markdown file changes",
    "engine": "claude/sonnet"
  }
}
```

The generator looks for `pde-<pdeId>.json` in two places, in this order:

1. `<directory of the project file>/<pdeFolder>/pde-<pdeId>.json` — the usual case, `pdeFolder`
   relative to the machine
2. `<pdeFolder>/pde-<pdeId>.json` — when `pdeFolder` is already absolute

If neither exists the generator carries on silently with no PDE enrichment. Nothing errors, so
**verify the file is where you said it is**:

```bash
ls "$(dirname /abs/path/machine.smdf.json)/.pde/2604161300--a6582030-…/pde-a6582030-….json"
```

What it reads from the PDE JSON:

| PDE field | Becomes |
|---|---|
| `prompt` | The *Originating prompt* blockquote under **R** |
| `result.primary.target` | The tagline and Desired Outcome, when no `intent` is passed |
| `result.directions.east[]` | The **Vision (🌅 East)** list under **I** |
| `result.actionStack[]` | **Action Steps**, each tagged with its direction |
| `result.ambiguities[]` | **Open Questions**, with the suggestion italicised beneath |

The confirmation that enrichment happened is the `**Source PDE:** \`<id>\`` line under the
namespace. No line, no enrichment.

---

## Machines that walk the four directions

When the machine's top-level states are named `East`, `South`, `West`, `North`, the generator
emits **Action Steps** as a medicine-wheel walk in the order **South → East → North → West**,
each direction with its glyph and description, its children listed as numbered steps:

```markdown
### Action Steps

**🔥 South** — Analysis: research, learning, growth
1. Choose implementation language and filesystem-watch library
2. Define the webhook payload schema

**🌅 East** — Vision
1. …
```

Glyphs: 🔥 South · 🌅 East · ❄️ North · 🌊 West.

This section appears only when those direction states exist, or when a PDE action stack does.
A machine modelling a ceremony gets a ceremony's spec; a machine modelling an order pipeline
gets a pipeline's.

---

## From the web designer

The 📜 RISE button in the toolbar calls `POST /api/rispec`, which produces the same document
from the same file. Optional body:

```bash
curl -sS -X POST http://127.0.0.1:4598/api/rispec \
  -H 'content-type: application/json' \
  -d '{"intent":"Orders reach fulfilment or a stated refusal"}'
```

```json
{ "rispec": "# OrderWorkflow — RISE rispec\n\n…", "projectFile": "/abs/path/machine.smdf.json" }
```

It returns 404 `{"error":"No file at <path>"}` when the web process's
`STATELOOM_PROJECT_FILE` points at nothing — the same absolute-path discipline as everywhere
else.

---

## A rispec worth reading — checklist

Before handing one on:

- [ ] `intent` was supplied, or the PDE provided one — no `_(no intent supplied)_` placeholder
- [ ] Every state carries a `description`; the **States** section reads as sentences
- [ ] Every event carries a `description`; the **Events** section explains what arrives, not
      just what is named
- [ ] The *Current* line matches what you believe about the machine — if it says "no terminal
      state declared", either that is true or the design is incomplete
- [ ] `**Source PDE:**` appears when the machine came from a decomposition
- [ ] The flat transition list contains no `→ (internal)` you cannot justify
- [ ] Saved as `<machine>.rispec.md` beside the SMDF, regenerated rather than edited

---

## The loop this closes

```
PDE  →  STC  →  SMDF  →  codegen
                  │
                  └──►  rispec  ──►  review, handoff, the next PDE
```

The rispec is how a machine re-enters conversation. Generate one when the design stabilises,
when someone who does not read JSON needs to review it, and when the work is handed to
another pair of hands.
