# @miadi/stateloom-stage

A stage for stateloom drawings, for a person and an agent working on one system.

- **The agent shows.** A tour (`<name>.tour.json`) is a walk through drawings: each step
  opens a state machine, an ERD or a sequence, lights some elements and says something about
  them. The stage plays it like a short presentation: the camera moves to what the step
  lights, the caption shows the words, the browser's voice can say them. Play, pause, step.
- **The agent points, live.** With `useLoomCue` the stage joins a hub room, so the MCP `show`
  tool (`view:show`) opens a drawing and lights an element while the person watches.
- **The person points back.** Tap elements to pick them (the tour pauses), choose what kind
  of mark it is (question, concern, change, looks right, note), type or dictate, send. The
  host receives a `MarkDraft` and appends it to `marks.jsonl` beside the drawings. The agent
  reads that file at the top of its next turn and knows what was pointed at, in the person's
  words.

The stage never writes anything. Where a mark goes is the host's choice.

```bash
npm install @miadi/stateloom-stage
```

```tsx
import { DiagramStage, readTour, readMarks, type MarkDraft } from "@miadi/stateloom-stage";
import "@miadi/stateloom-canvas/styles.css";
import "@miadi/stateloom-stage/styles.css";

<DiagramStage
  drawings={[
    { path: "screenwalk.smdf.json", doc: smdfJson },
    { path: "screenwalk.erdf.json", doc: erdfJson },
    { path: "screenwalk-2026-10-01.sqdf.json", doc: sqdfJson },
  ]}
  tour={readTour(tourJson).value}
  tourPath="screenwalk.tour.json"
  marks={readMarks(marksJsonl).marks}
  person="william"
  onMark={(draft: MarkDraft) =>
    fetch("/api/marks", { method: "POST", body: JSON.stringify(draft) }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
    })
  }
/>
```

Live cues from the hub:

```tsx
import { useLoomCue } from "@miadi/stateloom-stage/live";

const { cue, status } = useLoomCue({ url: "http://127.0.0.1:4599", docId: "/abs/path/system.sysdf.json" });
<DiagramStage drawings={drawings} cue={cue} />;
```

## The two files

A tour, `stateloom.tour.v1`. Members are paths relative to the tour file. A step without a
`member` stays on the previous step's drawing. `focus` uses the system's element strings:
`state:Name`, `transition:<state>:<index>`, `event:Name`, `entity:Name`,
`attribute:Entity.field`, `participant:Name`, `message:9`.

```json
{
  "format": "stateloom.tour.v1",
  "title": "How a screenwalk becomes media",
  "by": "mia",
  "steps": [
    { "member": "screenwalk.smdf.json", "focus": ["state:Recording"], "title": "It starts as a recording", "text": "…" },
    { "focus": ["event:stop", "state:Uploading"], "text": "…", "say": "what the voice says, when it differs" },
    { "member": "screenwalk.erdf.json", "focus": ["entity:Screenwalk"], "text": "…" }
  ]
}
```

Marks, `stateloom.mark.v1`, one JSON object per line of `marks.jsonl`. A later line with the
same `id` updates the mark, so an answer is appended (`status: "answered"`, `answer: "…"`),
never edited in place:

```json
{"format":"stateloom.mark.v1","id":"…","at":"2026-10-20T03:00:00.000Z","by":"william","member":"screenwalk.smdf.json","focus":["state:Recording"],"kind":"question","note":"Who stops the recording?","tour":"screenwalk.tour.json","step":0,"status":"open"}
```

`describeMark(mark)` gives an agent one sentence per mark.

## Props

| prop | |
|---|---|
| `drawings` | `{ path, doc, label? }[]`: parsed `.smdf.json`, `.erdf.json`, `.sqdf.json`. A system file is skipped and named as such. |
| `tour`, `tourPath` | A tour from `readTour`, and its path (carried into marks). |
| `marks` | From `readMarks`. Shown as counts on the drawing tabs and in a list. Tap one to light it again. |
| `cue` | `{ member?, focus?, text?, from?, seq }`. Shown once per `seq`. Stops a playing tour. |
| `onMark` | Receives a `MarkDraft`. Resolve to clear the composer, reject to keep the draft and show the error. |
| `person` | Who is marking. |
| `voice`, `lang` | Read captions aloud (default true, `en-US`). Dictation uses the same language. |
| `initialMember`, `initialStep`, `onShow` | For a host that keeps what is shown in its address. |
| `boardHeight`, `theme`, `className`, `style` | `theme` is the canvas theme; the stage's own chrome reads `--sls-*` variables. |

The board is the `@miadi/stateloom-canvas` canvases, read-only, with their `spotlight` prop.
The frames come from `@miadi/stateloom-protocol` (`machineFrame`, `erdFrame`,
`sequenceFrame`), so a headless renderer frames a step the same way.
