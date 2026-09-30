# SQDF — Sequence Definition Format

> RISE Framework Specification
> References: Spec 70 (SMDF Format), Spec 80 (ERDF Format), Spec 82 (System Definition), Spec 73 (MCP Server), Spec 74 (Web Designer)

**Spec ID**: 81
**Version**: 1.0
**Status**: landed — protocol 0.1.9, canvas 0.1.5 (`<SequenceCanvas>`), mcp 0.3.0 (14 sequence tools), web 0.2.0 (the sequence workspace), skills 0.4.0 (`stateloom-sequence`)
**Implementation**: TypeScript — `bridge-protocol/src/sequence/`, `mcp/src/sequence.ts`, `bridge-canvas/src/SequenceCanvas.tsx`, `web/src/components/sequence/`
**Origin**: jgwill/smcraft#28; the Episode 121 sequence diagram format circle (ceremony `19aa6862-121d-4125-bc2d-aef834dbe05d`); the Episode 140 scenario, drawn by hand before this format existed

## Creative Intent

**What SQDF Enables Users to Create:**
A declarative JSON document where humans and agents tell a usage scenario — who sends what to whom, in order — beside the machines (SMDF) and the data (ERDF) of the same system. The scenario names what its siblings define, so the loom can check it and walk it through the machines.

**Desired Outcomes:**
1. A person or an agent writes one `.sqdf.json` file and reads it back as a sequence diagram
2. A message that fires an event of a machine, carries an entity, or says which state follows, is checked against the drawings that define those names (Spec 82)
3. Where an alternative begins is written in the document, never left to the drawing
4. The format is domain-neutral: the trading scenario of Episode 140 and an order in a shop are written the same way

## Core Concepts

### SequenceDefinition

```json
{
  "settings": { "namespace": "...", "name": "...", "description": "...", "notes": "..." },
  "participants": [ { "name": "...", "actor": "...", "service": "...", "object": "...", "holds": ["Entity"] } ],
  "messages": [ { "from": "...", "to": "...", "label": "...", "event": "...", "carries": "...", "state": "..." } ],
  "fragments": [ { "kind": "alt", "label": "...", "after": 11, "messages": [ ... ] } ]
}
```

A sequence is a **sibling** of SMDF and ERDF. It links to them by name only and holds no path to either; the system document (Spec 82) is the one place that says which documents belong together.

### SqdParticipant

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique within the sequence; what messages name in `from` and `to` |
| `actor` | string | This participant is an actor of the system (`actors[].name` in the `.sysdf.json`): a person, an agent |
| `service` | string | A running service or component, free text (`jgt-charting`, `:8085`) |
| `object` | string | This participant IS the object `settings.objects[].instance` of a member machine |
| `holds` | string[] | Entities this participant keeps (ERDF `entities[].name`) |
| `description`, `notes` | string | As everywhere in the loom: what it is, and the conversation about it |

### SqdMessage

| Field | Type | Description |
|-------|------|-------------|
| `from`, `to` | string | Participant names. Equal for a message to oneself |
| `label` | string | What is said or done, in a few words |
| `event` | string | An event id of a member machine. Firing it is what the message does to the behaviour |
| `machine` | string | `settings.name` of the machine the event is for, when several define it; also where `state` is read |
| `carries` | string | An entity the message carries |
| `state` | string | The state the machine is in once the message is handled — a state invariant. The replay checks it; reconcile uses it to add the transition a machine lacks |
| `optional` | boolean | The scenario holds with or without this message |
| `reply` | boolean | A reply to an earlier message (drawn dashed) |

A message may name an event, carry an entity, both, or neither. Five of the thirteen Episode 140 messages move data or compute and fire no event.

### SqdFragment

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"alt"` \| `"opt"` \| `"loop"` | `alt`: instead of the main messages after `after`, these happen. `opt`: these may happen, then the main messages continue. `loop`: these repeat, then the main messages continue |
| `label` | string | The condition, in words |
| `after` | integer | The main message it branches after; `0` before the first |
| `messages` | SqdMessage[] | Its own messages |

### Addresses

Main messages are numbered from 1 in the order written: `"9"`. A fragment's messages are `f<fragment>.<message>`: `"f1.2"` is the second message of the first fragment. The same addresses are used by the tools, the replay, the canvas and a `focus` (`message:f1.2`).

## Validation Rules

The document's own shape. Whether the names it uses exist is the system's question (Spec 82, L005–L008).

| Rule | Description |
|------|-------------|
| S001 | `settings.name` is present |
| S002 | Participant names are non-empty and unique |
| S003 | Each message's `from` and `to` name a participant |
| S004 | Each message has a label |
| S005 | A fragment's `kind` is `alt`, `opt` or `loop`, and `after` is a main message number (0 to the count) |
| S006 | A fragment holds at least one message |

## File Format

**Canonical**: `.sqdf.json`. Tools pick the document type from the extension; `isSequenceDefinition()` tells the shapes apart when only content is at hand (a sequence carries `participants` and `messages`, never `entities` or a `state` tree).

## Edits

`bridge-protocol/src/sequence/edit.ts` is the one vocabulary the MCP tools and the canvas speak: `addParticipant`, `updateParticipant`, `removeParticipant` (takes its messages with it, as removing an entity takes its relationships), `addMessage`, `updateMessage`, `removeMessage`, `moveMessage`, `addFragment`, `updateFragment`, `removeFragment`, `addFragmentMessage`, `updateSqdSettings`, `summarizeSequence`. Inserting, removing or moving a main message keeps every fragment on the message it branches after.

## Rendering

`renderMermaidSequence(def)` produces a Mermaid `sequenceDiagram`. A participant naming an actor is an `actor`, the others `participant`, aliased so any name is safe. A message that fires an event shows it after the label. An optional message sits in its own `opt`. An `alt` fragment is drawn at its branch point with an `else as written` holding the main messages it replaces, so both paths read from the branch on.

`sequenceLayout(def)` gives the geometry every canvas shares: participants in one row with lifelines, main messages downward, and each fragment below them in a framed box headed by its kind, its branch point and its label.

## MCP Tools

**Build** — `create_sequence`, `add_participant`, `update_participant`, `rename_participant`, `move_participant`, `remove_participant`, `add_message`, `update_message`, `remove_message`, `move_message`, `add_fragment`, `add_fragment_message`, `remove_fragment`. Messages are addressed by their ref (`"9"`, `"f1.2"`), fragments by number from 1.

**Check** — `validate_sequence` (S001–S006). The system's checks, the replay and reconcile are Spec 82's tools.

**By extension** — `set_project_file`, `get_definition`, `load_definition`, `get_notes`/`set_notes` and `render_diagram` (mermaid, to `<name>.seq.mmd`) answer for a sequence when it is the active document. A sequence travels to the live canvas whole, as an ERD does.

When the sequence belongs to a system whose reconcile mode is `auto` (Spec 82), each edit also brings the machines, the data and the actors level with the scenario and says so in one line.

## Canvas and Designer

`<SequenceCanvas>` in `@miadi/stateloom-canvas` has the contract of the other canvases: props in, callbacks out, the host owns definition and viewport, the same gestures and `--slc-*` theme. The sequence workspace in `web/` opens for a `.sqdf.json`, edits with the pure functions above, writes to disk and then pushes the whole document to its hub room. On a phone it keeps the ERD workspace's shape: one-row header, the board first, the panel as a bottom sheet behind a dock (Participants, Messages, Notes, Issues), drawn outline icons.

## Creative Advancement Scenarios

### Scenario: A Scenario Drawn by Hand Becomes a Document
**Desired Outcome**: Episode 140's usage scenario is a file the loom draws, checks and walks
**Current Reality**: It exists as hand-drawn SVG on a proposal page; nothing can check it or reuse it
**Natural Progression**: The agent writes seven participants and thirteen messages, links each message to the event it fires and the entity it carries, and marks the alternative as branching after message 11
**Resolution**: `examples/wave-count/wave_count_to_entry.sqdf.json`, drawn by the loom, and replayed through `ElliottWaveCountLifecycle` (Spec 82)

### Scenario: An Agent Tells a New Story
**Desired Outcome**: A new behaviour is designed by telling it as a scenario first
**Current Reality**: New behaviour starts in the state machine, where the order of acts between people and services is invisible
**Natural Progression**: The agent adds a message with a new event and the state it leads to; the system check says which machine does not know it yet; reconcile adds it (Spec 82)
**Resolution**: The scenario and the machine tell the same story, and the person opening the machine finds it already updated

## Dependencies

- **Spec 70 (SMDF)**: the events, states and objects a message and a participant name
- **Spec 80 (ERDF)**: the entities a participant holds and a message carries
- **Spec 82 (System)**: the document that joins a sequence to its siblings, the L005–L008 checks, the replay and reconcile
