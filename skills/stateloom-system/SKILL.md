---
name: stateloom-system
description: Treat a system's drawings as one system — what an agent and a person talk over, and what a session that does not finish hands to the next instance — through the stateloom MCP tools — a .sysdf.json that names its ERD, state machines and sequences and the actors they share. Use when calling create_system, add_member, remove_member, add_actor, remove_actor, set_reconcile_mode, check_system, replay_scenario, reconcile_scenario or show; checking every name that crosses between drawings (Y001-Y004, L001-L008); replaying a scenario through the machines; letting a scenario update the machines, the ERD and the actors (propose or auto mode); pointing the live canvas at a member and an element while talking to a person; or generating one RISE rispec from a whole system; also when arriving in a repo that may hold a .sysdf.json from an earlier session, or before ending a design discussion that is not finished.
---

# One system, many drawings

A system is a `.sysdf.json` document (**SYSDF**) that names the drawings of one thing being
built — its data (`.erdf.json`), its behaviours (`.smdf.json`) and its scenarios
(`.sqdf.json`) — and the actors its scenarios share. It is the only document that holds
paths; the drawings keep linking to each other by name.

Full specification: `rispecs/82-sysdf-system.spec.md` in `jgwill/smcraft`. Worked example:
`examples/wave-count/elliott_wave_count.sysdf.json` (Episode 140).

---

## Why it exists — read this before anything else

A system is what an agent and a person **talk over**, and what a session that does not finish
**hands on**. Guillaume (2026-10-01): "what we created is exactly for this type of session that
I'm never capable of actually fully complete … or at least leave a system and a set of diagrams
and things for future instances, which is going to be really good information regarding why
we're creating what we're creating here."

**Arriving in a repo:** look for a `.sysdf.json` near the work (`find . -name '*.sysdf.json'`).
If there is one, `get_notes` on it and open it on the canvas before you design anything — it is
the last instance's hand-off, and its L008 warnings are the open work.

**During a design discussion:** draw as you talk. When a state is one where an agent has work to do (open a discussion, hold a question), write what it resolves there with `set_prompt` — the state machine then carries the prompting, not a page that drifts from it. Tell the person's scenario as a sequence,
let reconcile build the machine it implies (`auto` mode), and `show` the person the drawing you
mean instead of describing it.

**Before the session ends — even unfinished:**

1. The system exists beside the diagrams it joins (or in the episode's `diagrams/` room).
2. The scenario discussed is in a `.sqdf.json`, even partial; open alternatives are `alt`
   fragments, not prose.
3. `set_notes` on the system: the question that started it, what was decided, what is still
   open, and who decided — in plain words, for an instance that was not here.
4. `check_system`: leave its warnings as they are. They are the next instance's to-do list.
5. Give the person the canvas link to the map.

---

## Build it

```
create_system { "namespace": "shop", "name": "Shop", "path": "/abs/diagrams/shop.sysdf.json" }
add_member    { "path": "shop.erdf.json" }          // relative to the system file
add_member    { "path": "order.smdf.json" }
add_member    { "path": "place_order.sqdf.json" }
add_actor     { "name": "Buyer", "kind": "person" } // person | agent | service | external
```

A system holds ERDs, machines and sequences — never another system. Member paths are stored
relative to the system file when they sit beneath it, so the folder moves as one.

---

## Check it

```
check_system
```

Errors first, then warnings, then the replay per path.

| Rules | What |
|---|---|
| Y001–Y005 | the system document: name, members, readable members, actors, no two machines with one name |
| E, S, V | each member's own rules |
| L001–L004 | machines against the ERD (objects are entities, guards read attributes, `stateOf`) |
| L005 | a message's event is an event of a member machine |
| L006 | a participant's actor, object and held entities exist |
| L007 | a message's carried entity exists |
| L008 (warning) | each scenario path is a walk the machines accept |
| L009 (warning) | a state that is not final has a way out — usually a state a scenario just added |

L008 is a warning on purpose: a scenario ahead of its machines is how new behaviour is
designed. Only the first stop of each machine on each path is reported; the stops after it
are counted.

---

## The replay — two ways to tell the same story

```
replay_scenario
```

Each message's event is followed through every machine that defines it, from the machine's
first state, by the runtime's own rules (leaf first, then ancestors; composites enter their
first child; `final` ends the machine). Guards cannot run here, so the walk keeps every state
a guard could lead to until a later message or a message's `state` decides.

Paths: `main`, `main without optional messages` (if any are optional), and one per fragment.

---

## Reconcile — the scenario updates the drawings

```
reconcile_scenario                    // what the scenarios imply, with reasons
reconcile_scenario { "apply": true }  // write it: machines patched live, ERD and system written
```

What it can do from the story alone: add an event no machine defines (in the sender's
source), add a transition a machine refuses when the message says which `state` follows (and
the state, if missing), add entities that messages carry or participants hold to the ERD, add
actors to the system, declare a participant's object when one machine and one held entity say
which. It never removes or rewrites.

What it leaves **open**, in words: a refusal with no `state`, a `state` that contradicts the
walk, a machine that already ended, a choice between several possible states, and a stop
on the path without optional messages (that is a claim about the scenario, not a gap in the
machine). Decide, or ask the person.

### The mode — do not make the person approve every step

```
set_reconcile_mode { "mode": "auto" }     // or "propose" (the default)
```

- **`propose`**: sequence edits end with one line, `N changes proposed`, and wait for
  `reconcile_scenario apply`.
- **`auto`**: every sequence edit applies what it implies at once and ends with one line,
  e.g. `auto: OrderLifecycle +2, ShopData +1; 1 left open`. The person opening the machine
  finds it already updated.

The mode is written in the system (`settings.reconcile`); `STATELOOM_RECONCILE=auto|propose`
overrides it for one session. In `auto`, report the one line and move on — do not list every
change unless asked.

---

## Show — point the canvas while you talk

```
show { "member": "order.smdf.json", "focus": "state:Paid", "note": "the new state" }
```

The canvases open on the system switch to that member and select the element. A focus is
`<kind>:<name>`: `entity:Order`, `attribute:Order.status`, `state:Paid`, `event:Pay`,
`object:order`, `participant:Bank`, `message:9`, `message:f1.2`. Nothing is written; a view
is never part of a document.

On the canvas a person sees the same system: the system map (members, links between them,
checks, the mode), and above every member a strip with the other members and the links of
the selected element.

---

## RISE

`generate_rispec` with a system active writes one rispec: the data from the ERDs, the
behaviour per machine, each scenario path as a **Creative Advancement Scenario** (its
Resolution is where the replay ends), and the L008 findings and open items as questions.
