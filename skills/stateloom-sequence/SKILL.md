---
name: stateloom-sequence
description: Design a sequence diagram (a usage scenario) conversationally through the stateloom MCP tools, as a .sqdf.json beside a system's state machines and ERD. Use when creating or editing a .sqdf.json, calling create_sequence, add_participant, update_participant, rename_participant, move_participant, remove_participant, add_message, update_message, remove_message, move_message, add_fragment, add_fragment_message, remove_fragment or validate_sequence, telling who sends what to whom and in which order, linking a message to the event it fires, the entity it carries or the state it leads to, writing alt / opt / loop fragments with their branch point, fixing S001-S006 errors, or designing new behaviour by telling it as a scenario first.
---

# Designing a sequence through the MCP tools

A sequence here is a `.sqdf.json` document: **SQDF**, the third document of the loom beside
SMDF (behaviour) and ERDF (data). It tells one usage scenario — who sends what to whom, in
order — and it names what its siblings define, so the loom can check it and walk it through
the machines.

Full specification: `rispecs/81-sqdf-format.spec.md` in `jgwill/smcraft`. The system that
joins a sequence to its machines and its ERD is `rispecs/82-sysdf-system.spec.md` and the
`stateloom-system` skill.

---

## Step 0 — The active document's type is its extension

`.smdf.json` machine, `.erdf.json` ERD, `.sqdf.json` sequence, `.sysdf.json` system. The
sequence tools act while the active document is a `.sqdf.json`. `create_sequence` also moves
the active document there.

```
get_project_file
create_sequence  { "namespace": "shop", "name": "PlaceOrder", "path": "/abs/diagrams/place_order.sqdf.json" }
```

---

## The tools

| Group | Tools |
|---|---|
| Create | `create_sequence(namespace, name, description?, path?, overwrite?)` |
| People and parts | `add_participant(name, actor?, service?, object?, holds?, description?, at?)`, `update_participant`, `rename_participant(name, to)` (every message follows), `move_participant(name, to)` (column, from 1), `remove_participant` (takes its messages with it) |
| The story | `add_message(from, to, label, event?, carries?, state?, machine?, optional?, reply?, at?)`, `update_message(ref, …)`, `remove_message(ref)`, `move_message(ref, to)` |
| Sometimes | `add_fragment(kind, label, after, messages?)`, `add_fragment_message(fragment, …)`, `remove_fragment(fragment)` |
| Check | `validate_sequence()`; the system's checks are `check_system`, `replay_scenario`, `reconcile_scenario` |
| Notes | `get_notes()`, `set_notes(target?, notes)` |

Messages are addressed by **ref**: `"9"` is main message 9, `"f1.2"` the second message of
the first fragment. Fragments are numbered from 1.

---

## What a participant is

Say what each participant IS, because that is what the system checks (L006):

| Field | Meaning | Checked against |
|---|---|---|
| `actor` | a person or an agent | the system's `actors` |
| `service` | a running service, free text | nothing — a label |
| `object` | the participant IS a machine's object (`settings.objects[].instance`) | the member machines |
| `holds` | entities it keeps | the ERD |

---

## What a message does

A message may do any of these, or none:

- **`event`** — fires that event in every member machine that defines it (only in `machine`,
  when several define it). Checked by L005, walked by the replay.
- **`carries`** — the entity it moves. Checked by L007.
- **`state`** — the state the machine is in once it is handled. The replay checks it, and
  **it is what lets reconcile add a transition** the machine lacks. When you invent a new
  behaviour, always say where it leads.
- **`optional`** — the scenario holds with or without it. The replay walks a second path
  without optional messages; if the rest depends on one, it is reported as not optional.
- **`reply`** — drawn dashed.

A message that only moves data or computes fires no event. That is normal.

---

## Fragments: say where the alternative begins

```
add_fragment { "kind": "alt", "label": "card declined", "after": 2,
               "messages": [ { "from": "Bank", "to": "Shop", "label": "declined", "event": "Decline" } ] }
```

- `alt` — **instead of** the main messages after `after`
- `opt` — may happen after `after`; the main messages continue
- `loop` — repeats after `after`; the main messages continue

`after` is a main message number (`0` = before the first). Inserting, removing or moving a
main message keeps each fragment on the message it branches after.

---

## Designing new behaviour by telling it

This is the loop the system exists for. In a system (see `stateloom-system`):

1. `add_message` with a **new event** and the **state** it leads to.
2. If the system's reconcile mode is **`auto`**, the tool already applied what the story
   implies — the event, the state, the transition, a carried entity — and its answer ends with
   one line such as `auto: OrderLifecycle +2, ShopData +1`. The person opening the machine
   finds it updated. Nothing to approve.
3. If the mode is **`propose`**, the answer ends with `N changes proposed`; run
   `reconcile_scenario` to read them and `reconcile_scenario { "apply": true }` to apply.
4. What the story does not say (a refusal with no `state`, a `state` that contradicts the
   machine) comes back as **left open**, in words. Decide, or ask the person.

---

## Rule errors

| Rule | Means | Fix |
|---|---|---|
| S001 | no `settings.name` | `create_sequence` sets it |
| S002 | a participant with no name, or twice | rename one |
| S003 | a message from or to someone who is not a participant | `add_participant` first |
| S004 | a message with no label | say what happens, in a few words |
| S005 | fragment kind unknown, or `after` outside the main messages | `alt`/`opt`/`loop`, and `after` ≤ the count |
| S006 | a fragment with no message | add one, or remove the fragment |

---

## Drawing it

`render_diagram` writes a Mermaid `sequenceDiagram` (`<name>.seq.mmd`): actors as actors,
the event after each label, optional messages in `opt`, an `alt` at its branch point with an
`else as written` holding the path it replaces. On the live canvas the sequence opens in its
own workspace; in a system, the strip at the top switches to the machines and the ERD.
