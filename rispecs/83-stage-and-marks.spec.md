# The Stage and the Marks — the agent shows, the person points back

> RISE Framework Specification
> References: Spec 77 (Real-Time Design Bridge), Spec 74 (Web Designer), Spec 73 (MCP Server), Spec 80 (ERDF), Spec 81 (SQDF), Spec 82 (SYSDF, the view)

**Spec ID**: 83
**Version**: 1.0
**Status**: landed — protocol 0.1.15 (`stage/`: tours, marks, boxes, the review), hub 0.1.7 (stage rooms, the marks relay, `GET /stage/<name>`), client 0.1.4 (`joinStage`, `emitStep`/`emitLoad`/`emitControl`/`emitContext`/`emitMarks`), react 0.1.7 (`createStageSession`, `useStage`, `browserVoice`, `browserDictation`), canvas 0.1.6 (`StageOverlay`, `StageCaption`, `MarkComposer`, `MarkThread`, `MarksPanel`), cli 0.1.5 (`smcx stage`, `smcx marks`), mcp 0.4.0 (9 stage tools), skills 0.5.0 (`stateloom-stage`), web 0.3.0 (the stage on every board, `/api/marks`)
**Implementation**: TypeScript — `bridge-protocol/src/stage/`, `bridge/src/hub.ts`, `bridge-client/src/client.ts`, `bridge-react/src/{stage,useStage,speech}.ts`, `bridge-canvas/src/{StageOverlay,StageCaption,MarkCards}.tsx`, `cli/src/commands/stage.ts`, `mcp/src/stage.ts`, `web/src/components/stage/`, `web/src/app/api/marks/route.ts`
**Origin**: Guillaume, 2026-10-18: "the agent should be capable of controlling which diagram is currently showing up, because it's his job to actually show us the work … pretty much like they would prepare something that plays back, like a PowerPoint presentation … And also, it would be nice at the reverse, if we select something on the diagram, any diagram, and we would need to give some marks or some annotation to advise the agent of what are we currently being selecting or in context."

## Creative Intent

**What the stage and the marks enable people to create:**
A conversation held over the drawings themselves. The agent shows its work where it lives — this
drawing, these elements, this sentence — and can prepare the explanation as a walkthrough anyone
plays later. The person answers by pointing: an element or an area of any drawing, and what they
want the agent to know about it. The agent reads what was pointed at before it replies, and its
answer stays on the drawing where the question was raised.

**Desired Outcomes:**
1. An agent opens any drawing on the person's canvas, lights what it means, and says a sentence beside it — one step at a time while it talks
2. A walkthrough is a file (`.tour.json`) the canvas plays back with its own controls and, when the person wants it, a voice
3. A person marks elements or an area of any of the three drawings and says (types or speaks) what the agent should know
4. The agent reads what the person is looking at and the marks waiting before it replies, and answers in the mark's thread
5. A session can wait for the person's next mark — by holding a tool call, or as a background task that wakes it
6. All of it reusable by any host that draws the boards (Miadi, Forgewright): the layer, the caption and the cards are components, the session is a hook

## Why a stage, and why marks

Spec 82 gave the agent `show`: open a member of a system, focus one element. Watching sessions use
it, three things were missing:

- **One element is rarely the point.** An explanation is about a state and the event that leaves
  it, two messages and the entity they carry. The agent needs to light several and dim the rest,
  or frame an area — on any drawing, inside a system or not.
- **The words belonged beside the drawing.** The agent's sentence arrived in the terminal while
  the drawing changed in the browser; the person read one and looked at the other. A step carries
  its words, shown as a caption over the board.
- **An explanation has an order, and outlives the session.** Prepared once as a tour, it is
  played by the person when they have time, by a reviewer, by the next instance — the walkthrough
  is part of what a session hands on (Spec 82, "the session that does not finish").

The other direction had nothing at all. A person reading a sequence wanted to say "these two
messages — why?" and could only type the names into a prompt, by hand, hoping to spell them as
the document does. A mark is that pointing, made on the drawing, in the document's own names, and
kept where it was made. The words match `@miadi/annotate-core` — a review of a drawing reads like
a review of an agent's reply (`comment`, `looks_good`, `delete`, plus `question` for what an agent
asks).

## Core Concepts

### A step

```json
{ "doc": "elliott_wave_count.smdf.json", "system": "elliott_wave_count.sysdf.json",
  "focus": "state:Published", "spotlight": ["state:Published", "event:Evaluate"],
  "region": { "x": 120, "y": 80, "width": 460, "height": 220 },
  "title": "Where the count must be", "say": "The count must be Published before Evaluate can leave it.",
  "audio": "https://…/voice/audio/…mp3", "holdMs": 6000 }
```

- `doc` the drawing to open; absent, whatever is open stays. `system`: open it as a member, so the strip stays.
- `focus` one element, selected and centred by the workspace's own focus (Spec 82's `focus=`).
- `spotlight` several elements lit while the rest dims; the view fits them.
- `region` an area in the drawing's coordinates, framed and fitted.
- `say` the words — the caption, and what a voice reads. `title` a few words over it.
- `audio` a recording of `say` to play instead of the canvas's voice (an agent's own voice service renders it).
- `holdMs` how long the step stays during play when nothing is heard; default `stepHoldMs` (400 ms a word, 2.5–20 s).

Element names are the focus names of Spec 82: `state:`, `event:`, `entity:`, `attribute:E.a`,
`participant:`, `message:9`, `machine:`, `object:`.

### A tour — `<name>.tour.json`

```json
{ "settings": { "namespace": "jgt.trading", "name": "Why the walk stops", "notes": "…", "author": "Mia" },
  "steps": [ { "doc": "wave_count_to_entry.sqdf.json", "spotlight": ["message:7"], "say": "…" }, { "focus": "state:Published", "say": "…" } ] }
```

Paths are relative to the tour file (`resolveTourPaths`), so a tour moves with its drawings. A step
without `doc` stays on the previous step's drawing (`stepDocs`); a `system` carries forward the same
way. Never listed as a drawing (`isLoomSidecar`).

| Rule | Description |
|---|---|
| T001 | a tour has a name |
| T002 | a tour has at least one step |
| T003 | a step says something (`say`) |
| T004 | `focus` is `<kind>:<name>` |
| T005 | each `spotlight` entry is `<kind>:<name>` |
| T006 | `region` is a box with a positive size |
| T007 | `doc` names a `.json` drawing, `system` a `.sysdf.json` |
| T008 | `holdMs` is 0 or more |
| T009 | `audio` is an `http(s)` URL or an absolute path |

### A mark — `<drawing>.marks.json`

```json
{ "doc": "elliott_wave_count.smdf.json",
  "marks": [ { "id": "m-0mvd4k2tckndr", "kind": "comment",
    "elements": ["state:Reading"], "region": { "x": 0, "y": 0, "width": 300, "height": 200 }, "level": "Root",
    "text": "Is Reading where the count starts?",
    "author": { "id": "guillaume", "name": "Guillaume", "role": "person" },
    "at": "2026-10-18T01:00:46.000Z", "status": "answered",
    "replies": [ { "author": { "id": "mia", "name": "Mia", "role": "agent" }, "text": "Yes: …", "at": "…" } ] } ] }
```

- **Beside the drawing, never in it.** `marksPathOf("wave.smdf.json") = "wave.smdf.marks.json"`;
  `.smdf` and `.erdf` of one name never share a sidecar. A drawing says what is being built; its
  marks say what people and agents said about it.
- **Anchored by name.** `elements` are focus names, so a mark survives a re-layout; `region` keeps
  the area as drawn, and `level` the machine level it was drawn at.
- **Ids sort by time** (`m-` + fixed-width base-36 time + 4 random).
- **The thread decides the status.** A reply from the other side answers (`answered`); a follow-up
  from the asker opens it again (`open`); `resolved` is closed and kept as a record, and a reply
  does not reopen it by itself. `marksWaitingOn(marks, role)`: a person's open marks and an agent's
  answered questions wait on the agent, and the other way round.
- **Read defensively** (`readMarksFile`): a broken entry is dropped, the rest kept. The web route
  refuses to write over a sidecar that does not parse (409).

### Boxes — where the elements are

A layer over a canvas never reaches into it. The protocol says where each element sits from the
same layouts the canvases draw with: `machineElementBoxes(levelStates, positions)` (an event's box
spans its arrow's two ends), `erdElementBoxes(def, positions, {rows})` (attribute rows; Chen answers
with the entity), `sequenceElementBoxes(def, layout)` (participants with their lifeline, each
message's band, `event:E` on every row that fires it). `elementAt` (the smallest box under a point)
and `elementsInRegion` (a third of an element inside the area) turn a tap and a drag into names.

## The wire

| Event | Direction | Payload | The hub |
|---|---|---|---|
| `stage:join` | client → hub | `{stage}` | joins `stage:<name>`, acks `{selfId, state: StageState}` |
| `stage:step` | both | `StageStepEnvelope {stage, step, index?, count?, tour?, title?, origin, at}` | keeps it as the stage's step; relays to the stage |
| `stage:load` | both | `StageLoadEnvelope {stage, tour, path?, from?, autoplay?, origin}` | keeps it as the stage's tour, drops the step; relays |
| `stage:control` | both | `{stage, action: play\|pause\|next\|prev\|goto\|stop, index?, origin}` | relays; `stop` drops tour and step |
| `stage:context` | both | `StageContext {stage, doc, kind, system, focus, visible, tour, who, at}` | keeps it as the stage's context; relays to others, never back |
| `marks:changed` | both | `MarksEnvelope {docId, marks, change?, stage?, origin}` | relays to the drawing's room and the stage named, never back |

- **A stage is a room that is not a document**: `stage:<name>` (letters, digits, `.`, `_`, `-`),
  never a path, so it never collides with a drawing's room; no file, no seq, no watcher.
- **What the hub keeps** of a stage — the step on screen, the tour, the last context — is in memory,
  as presence is, so a canvas opening late catches up. Gone when the hub restarts; marks are files.
- **The token** is checked on every stage frame, as on `view:show`; a sender need not have joined.
- **`GET /stage/<name>`** answers the `StageState` in JSON (`Authorization: Bearer <token>` when the
  hub has one), and `GET /health` the room and stage counts — for a script, a listener, a person.

## The canvas

`StageProvider` wraps whichever workspace is open and joins the stage (`?stage=`, else
`STATELOOM_STAGE` from `/api/config`, else `default`). A shown step opens its drawing inside its
system and focuses its element through `openInSystem` (Spec 82); what it lights is handed to the
`StageLayer` the open workspace mounts beside its canvas, which alone knows where its elements are:

- **Lit**: a scrim with a hole and a ring around each spotlighted element, a dashed frame for an
  area; the view fits them above the caption, after the workspace's own fit or centring. A machine
  drills to the level of the first lit state; a sequence in its list view switches to the diagram.
- **The caption**: who presents, the tour and step titles, the words, the step dots; ◀ ▶ ⏯, the
  voice toggle (off by default, remembered), **Answer**, ✕. Above the phone dock on a phone.
- **Marks**: ✎ turns marking on — a tap marks the element under it, a drag the elements inside the
  area and the area — and the composer asks what the agent should know, typed or spoken (🎙, where
  the browser can listen). Pins are numbered and coloured: amber waits on the agent, blue answered,
  violet an agent's question, grey resolved. A pin opens its thread: reply, resolve, reopen,
  remove. 💬 lists the marks, waiting first, and **Copy for the agent** puts the review on the
  clipboard to paste into any agent's prompt.
- **Context**: the drawing, the element in hand, the visible area and the tour's place go to the
  stage a moment after they settle.

`/api/marks?doc=` reads and changes a sidecar under the same root allowlist as `/api/file` (the
sidecar itself is checked too); the page tells the hub after the write.

## Agents

| Tool | What it does |
|---|---|
| `show_step` | one step now; `doc` defaults to the active document, `system` to the system that lists it |
| `write_tour` | a tour file beside the active document, paths stored relative to it, checked T001–T009 |
| `play_tour` | a tour to the canvases, from a step, playing or paused |
| `stage_control` | play, pause, next, prev, goto (from 1), stop |
| `read_marks` | what is on screen, then the marks waiting for the agent (`all` for every mark); scope: the active document and, for a system or its member, every member |
| `await_marks` | hold until the person's next mark or reply (≤ 600 s) |
| `answer_mark` | reply in a thread as the agent; `resolve`; `show` lights the mark with the answer as the caption |
| `add_mark` | the agent's question pinned on elements or an area |
| `what_is_on_screen` | the context alone |

`STATELOOM_STAGE` names the stage, `STATELOOM_AGENT_NAME` the agent on marks and captions.

`smcx stage show|play|control|where` and `smcx marks [--all] | await | reply` do the same from a
terminal. `smcx marks await` exits 0 with the person's mark, the context and the exact commands to
answer and to listen again, 4 on timeout — the background-task pattern of the Mia episode
companion's `mia-listen await`, for marks instead of spoken takes.

## Voice

The browser's voice (`browserVoice`, Web Speech synthesis) reads a step only when the person
turned it on. A step's `audio` is played instead when it has one: an agent renders its words with
its own voice service — in the Miadi ecosystem the `miadi-voice` MCP, the one sanctioned voice path
— and puts the recording there. The person's spoken marks use `browserDictation` (Web Speech
recognition) where the browser has it; where it does not, the 🎙 button is absent and they type.

## Reuse

`@miadi/stateloom-canvas` holds the drawing parts (props in, callbacks out, `--slc-*` themed):
`StageOverlay` over any board that shares a viewport, `StageCaption`, `MarkComposer`, `MarkThread`,
`MarksPanel`. `@miadi/stateloom-react` holds the behaviour: `createStageSession` (no React, tested
in Node), `useStage`, `browserVoice`, `browserDictation`. A host needs a viewport, the boxes from
the protocol, a place to keep sidecars (or none: marks are optional), and a hub URL.

## Structural Tension

**Current reality (before this spec)**: the agent could open one member of a system and focus one
element (`show`); its words went to the terminal; nothing could be prepared to play back; a person
could not point at a drawing at all, only type names into a prompt.

**Desired outcome**: the agent shows, in order, with words, on any drawing; the person points and
says; the agent reads the pointing before it replies and answers where it was raised; all of it
survives the session as files.

**Next (not built here)**: a mark that follows a renamed element (marks name elements; a rename
leaves them pointing at the old name, and `read_marks` shows them as they were); marks on the
system map; a voice bridge that renders tour captions through `miadi-voice` without the agent
doing it step by step; a stage per person when several share one hub; recording a tour played
with its voice as a screenwalk (the episode companion's media cycle).
