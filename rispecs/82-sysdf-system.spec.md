# SYSDF — System Definition Format, the Replay and Reconcile

> RISE Framework Specification
> References: Spec 70 (SMDF), Spec 80 (ERDF), Spec 81 (SQDF), Spec 73 (MCP Server), Spec 74 (Web Designer), Spec 76 (RISE rispec generator), Spec 77 (Real-Time Design Bridge)

**Spec ID**: 82
**Version**: 1.0
**Status**: landed — protocol 0.1.9, hub 0.1.5 (the view relay), client 0.1.3 (`emitView`), mcp 0.3.0 (10 system tools, `generate_rispec` from a system), web 0.2.0 (the system map and strip, the chronicle rule), skills 0.4.0 (`stateloom-system`)
**Implementation**: TypeScript — `bridge-protocol/src/system/`, `bridge/src/hub.ts` (view relay), `bridge-client/src/client.ts` (`emitView`, `on('view')`), `mcp/src/system.ts`, `web/src/components/system/`
**Origin**: Guillaume in the Episode 121 circle, 2026-09-24: "I agree that the 3 diagrams (and potentially more) describe one system". Decisions D1–D9 and requirement N1 of the *Stateloom Systems* proposal page, 2026-09-30.

## Creative Intent

**What SYSDF Enables Users to Create:**
One system out of the drawings of one thing being built: its data, its behaviours and its scenarios, checked against each other, walked by the scenarios, and kept level by them — so a person can move between the drawings and follow one element across them, an agent can design by telling a story, and the chronicle, the medicine wheel and RISE have one address to hold.

**Desired Outcomes:**
1. A `.sysdf.json` names its members and the actors its scenarios share
2. Every name that crosses between members is checked (L001–L008)
3. A scenario is replayed through the machines, and where the walk stops is named
4. The changes a scenario implies are proposed, or applied at once when the system's mode is `auto`
5. A canvas shows one member at a time, follows an element to the others, and obeys an agent's `show`
6. A session that does not finish leaves a system behind — the drawings, the scenarios told so far, and notes that say why — so the next instance continues from it instead of from a transcript

## Why a system: the discussion, and the session that does not finish

Guillaume, 2026-10-01, after the first release, watching a trading session where counting waves "doesn't work" and he wanted to talk it through with his agent:

> "I think what we built is going to be what that agent needs to have a discussion with me, giving me good representations and design and do the work that he has to do. And I'm thinking that what we created is exactly for this type of session that I'm never capable of actually fully complete and bring to completion, or at least leave a system and a set of diagrams and things for future instances, which is going to be really good information regarding why we're creating what we're creating here."

Two uses follow, and they shape the format:

- **The system is what the agent and the person talk over.** A session that discusses a design draws it as it goes: the scenario as the person tells it, the machine the scenario implies (reconcile builds it), the data it carries. The person reads drawings on the canvas, not a description of drawings; the agent points at what it means with `show`.
- **The system is what an unfinished session hands on.** Most sessions end before the work does. A transcript is long and only says what was said; a system says what was being built: which machines, which scenarios walk through them, where a walk still stops (L008 warnings are the next instance's to-do), and — in `settings.notes` and each drawing's notes — the question that started it and what was decided. The next instance opens the system and its notes before it designs anything.

Measured on 2026-10-01 against that session's prompt (a new "discussion" state reached from a button beside Publish): starting from an empty machine and the scenario alone, `reconcileSystem` in `auto` mode built the new machine's five states and their transitions, added the two entities to the ERD and the agent to the actors, and the replay then named a real design question — the "trade it" outcome asks for a blueprint before the count is evaluated, which the existing lifecycle refuses.

## Core Concepts

### SystemDefinition

```json
{
  "settings": { "namespace": "jgt.trading", "name": "ElliottWaveCount", "description": "...", "notes": "...", "reconcile": "propose" },
  "members": [ { "path": "elliott_wave_count.erdf.json" }, { "path": "elliott_wave_count.smdf.json" }, { "path": "wave_count_to_entry.sqdf.json" } ],
  "actors": [ { "name": "Guillaume", "kind": "person" }, { "name": "Agent", "kind": "agent" } ]
}
```

- **A system is a file, not a folder (D4).** A folder cannot carry a name, notes or actors, and cannot include a member stored elsewhere.
- **Only the system holds paths (D5).** Members keep linking by name (Spec 80). A member path is relative to the system file (`resolveMemberPath`, `relativeMemberPath`), so a system moves as one folder.
- **Three member kinds (D9).** `.erdf.json`, `.smdf.json`, `.sqdf.json`. A system is never a member of another. The list is open to later kinds (a structural tension chart, a PDE, a rispec).
- **Actors** are written once and shared by every scenario, as an entity is shared by every machine: `person`, `agent`, `service`, `external`, with an optional `wheelNode` (the medicine-wheel node the actor is).
- **What is shown is a view (D7).** Which member is open, which element is focused, where shapes sit: kept by the canvas, never in any document.

### Document kinds

`docKindOfPath(path)` → `machine` | `erd` | `sequence` | `system`, by extension; any other `.json` is a machine, as it always was. `docKindOfContent(doc)` answers from content.

## Checks — `checkSystem(system, members)`

| Rule | Description | Severity |
|------|-------------|----------|
| Y001 | The system has `settings.name` and `settings.namespace` | error |
| Y002 | Member paths are present, unique, and of a member kind | error |
| Y003 | A member can be read, and holds what its extension says | error |
| Y004 | Actor names are unique and their kinds known | error |
| Y005 | No two member machines share a `settings.name` (a message names a machine by it) | error |
| E, S | Each ERD's and each sequence's own rules | error |
| L001–L004 | Spec 80's links, for every machine against the entities of every ERD | error |
| L005 | A message's `event` is an event of a member machine (of `machine`, when named) | error |
| L006 | A participant's `actor` is an actor of the system, its `object` a machine object, its `holds` entities | error |
| L007 | A message's `carries` is an entity | error |
| L008 | Each path of each scenario is a walk the machines accept; a `state` names a state some machine has | warning |

A machine's own V rules live with the engine; the MCP adds them to `check_system`. L008 is a warning because a scenario ahead of its machines is how new behaviour is designed. Only the first stop of each machine on each path is reported; the stops after it are counted, since they are usually its consequence.

## The Replay — `replayScenario(sequence, machines)`

A sequence and a state machine tell the same story two ways. The replay reads the messages in order and, for each message that fires an event, follows the transition that event takes in every member machine defining it (only in `message.machine` when named) — a machine that does not define an event does not hear it.

It follows the runtime's rules (`ts/src/machine.ts`): start in the first enterable leaf of the root; look an event up on the current leaf, then each ancestor; a transition without `nextState` stays; entering a composite enters its first non-history child down to a leaf; entering a `final` state ends the machine.

Guards cannot be evaluated outside generated code, so the walk keeps the **set** of states the machine may be in. A guarded transition may or may not be taken; an unguarded one always is and ends the search, as at runtime. A message is the scenario's claim that its event is handled, so states that refuse it are dropped when others accept it, and `message.state` narrows the set the same way — reported as `state-mismatch` when the machine cannot be there.

Paths: `main`; `main without optional messages` when any message is optional; one per fragment — an `alt` is the main messages up to its branch point followed by its own, an `opt` inserts its messages, a `loop` inserts them twice. Parallel regions are not walked.

Each step reports `moved`, `stayed`, `refused`, `unknown-event`, `ended`, `state-mismatch` or `data`, with the states before and after and the guards assumed.

## Reconcile — the scenario upgrades the drawings (N1)

`reconcileScenario(sequence, machines)` replays and, where the scenario itself says how, proposes the machine edit as PatchOps — the vocabulary the hub already carries, so an applied proposal reaches a live canvas as an ordinary patch:

1. An event no machine defines → add it to the machine the message names (or the only machine), in the sender's source (`<Sender>Events`, a source named after the sender, or one it feeds), created when missing.
2. A refused event with a `state` on the message → add that transition on the state the machine is in, adding the state under the root first when missing.

`reconcileSystem(system, members)` does this for every scenario of the system and adds what a scenario names outside the machines: entities that messages carry or participants hold (to the ERD, with a note saying which message asked), actors a participant names (to the system), and a participant's object when one machine and one held entity say which.

Everything else is returned as `unresolved`, in words: a refusal without a `state`, a `state` that contradicts the walk, a machine that already ended, a refusal from several possible states, a stop on the path without optional messages (a claim about the scenario, not a machine gap), a `state` that belongs to another machine when the message does not name its machine, a machine name two members share, a state inside a parallel region, and a change that was proposed and did not let the walk through (never proposed twice). An empty machine gains its first state rather than a transition on its root. Nothing is removed or rewritten. `summarizeReconcile` gives the one line a tool or the strip shows.

### The mode — `settings.reconcile`

Guillaume, 2026-09-30: "you need not to bore the user with a bunch of things he needs to approve and validate … a modality."

| Mode | When a scenario is saved |
|---|---|
| `propose` (default) | The changes are listed with their reasons and wait for someone to apply them |
| `auto` | The changes are applied at once — machines written and patched to their rooms, ERDs written and sent whole, the system written — and one line says what changed |

The mode is a design choice of the people working on the system, so it lives in the system document. `reconcileModeOf(def, override)` lets a session override it (`STATELOOM_RECONCILE`).

## Links as data — `systemLinks(members)`

The same crossings, kept where both ends exist, as `{from, to, rule, text, back}` between element references `{member, kind, name}` — `entity`, `attribute`, `machine`, `object`, `event`, `state`, `participant`, `message`. The replay's main path adds `message → state` for each message that moves a machine. `linksOf(links, member, focus)` gives the links touching one element, read from its side. A `focus` is `<kind>:<name>` (`entity:WaveCount`, `message:f1.2`).

## The View — `view:show`

`ViewEnvelope { docId, member?, focus?, origin, note? }`. The hub relays it to the room named by `docId` — the system file's — and keeps nothing: no seq, no ring, no disk. The sender need not have joined that room; the token is checked as on join. `@miadi/stateloom-client` sends it with `emitView` and receives it with `on('view')`. The MCP's `show` tool is how an agent points the canvas at a member and an element while it talks.

## MCP Tools

`create_system`, `add_member`, `remove_member`, `add_actor`, `remove_actor`, `set_reconcile_mode`, `check_system`, `replay_scenario`, `reconcile_scenario` (dry run by default, `apply: true` writes), `show`. `generate_rispec` from a system writes one rispec: data from the ERDs, behaviour per machine, and each scenario path as a Creative Advancement Scenario whose Resolution is the replay's end state; L008 findings and unresolved items close it as open questions.

## Designer

`web/` opens a `.sysdf.json` as the **system map**: a card per member with its counts, lines between members labelled with how many names cross, the actors, the checks with the replay per path, and the reconcile mode with the proposed changes. With `system=` in the URL, every workspace shows a one-row **system strip**: the system name, a tab per member (drawn outline icons), and the links of the focused element, each opening the other member on that element. The strip listens on the system's room and follows an agent's `show`. Each workspace reads `focus` on load and writes it on selection.

A chronicle root (`STATELOOM_CHRONICLE_ROOT`) admits only `<root>/<episode>/diagrams/<file>.json` (D2) — no other path under the chronicle.

## Later outcomes

- **Several drawings on one surface.** Guillaume, 2026-09-30: "it's going to be possible to do multiple editing of multiple diagrams on the canvas surface." This release gives one member at a time, a switch between them that keeps the focused element, and machines that update live while a scenario is edited elsewhere. Drawing two or three members side by side on one board, with the links between their elements drawn across, is the next outcome; `systemLinks` already carries what such a board would draw.
- **More member kinds** (D9, Q1): a structural tension chart, a PDE, a rispec.
- **The wheel and the chronicle** hold a system as a node and a circle subject: jgwill/medicine-wheel#151, jgwill/Miadi#707.

## Creative Advancement Scenarios

### Scenario: Three Drawings Become One System
**Desired Outcome**: Episode 140's data, lifecycle and scenario open as one system
**Current Reality**: Three files beside each other, grouped only by their folder; the scenario was a picture
**Natural Progression**: `create_system` names the three; `check_system` finds no error and two warnings — without its optional message 7 the scenario stops at message 9, and the alternative that begins after message 11 is refused from `StrategicEntry`
**Resolution**: `examples/wave-count/elliott_wave_count.sysdf.json`, whose findings are the two the proposal page named by reading the files by hand

### Scenario: A Session That Does Not Finish Leaves a System
**Desired Outcome**: The next instance continues the design from what the last one built, and knows why
**Current Reality**: A session ends mid-discussion; what it understood lives in a transcript nobody rereads, and the next instance starts over from the person's memory
**Natural Progression**: As the discussion goes, the agent keeps a `.sysdf.json` beside the work: the scenario as told, the machines reconcile builds from it, notes on the system with the question that started it and what was decided; before stopping it runs `check_system` and leaves the warnings as they are
**Resolution**: The next instance opens the system, reads its notes, and sees on the map where the walk still stops — the open work, in the shape of the thing being built

### Scenario: An Agent Designs by Telling the Story
**Desired Outcome**: A new behaviour lands in the machine without a person approving each step
**Current Reality**: A scenario and a machine drift apart the moment one of them changes
**Natural Progression**: The system's mode is `auto`; the agent adds a message with a new event, the state it leads to and an entity it carries; the tool applies the new event, state, transition and entity, patches the open canvases, and answers in one line
**Resolution**: The person opens the lifecycle and finds the new transition already drawn

## Dependencies

- **Specs 70, 80, 81**: the three member formats
- **Spec 77 (Bridge)**: rooms by document path; the view relay rides the same hub
- **Spec 76 (RISE rispec)**: the per-machine generator the system rispec builds on
