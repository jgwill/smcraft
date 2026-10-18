# Talking on the Canvas — the person speaks about a drawing, Mia answers by walking it

> RISE Framework Specification
> References: Spec 83 (The Stage and the Marks), Spec 82 (SYSDF, the view), Spec 74 (Web Designer); jgwill/miadi-orchestration-kit `claude/mia-episode-companion` (the phone page, `mia-listen`)

**Spec ID**: 84
**Version**: 1.0
**Status**: landed (unpublished, in the versions Spec 83 already carries): react 0.1.7 (`createTakeRecorder`, `createCompanionThread`, `replyTour`, `takeContext`, `companionUrl`, `present()` on the stage session), canvas 0.1.6 (`CompanionDock`), web 0.3.0 (`/api/companion/*`, the Talk dock on every board); in the kit, phone-capture 0.3.0 (replies with steps, a voice per step, a take's canvas) and `mia-listen reply --steps`
**Implementation**: TypeScript — `bridge-react/src/companion.ts`, `bridge-react/src/stage.ts` (`present`), `bridge-react/src/speech.ts`, `bridge-canvas/src/CompanionDock.tsx`, `web/src/components/stage/CompanionLayer.tsx`, `web/src/app/api/companion/[...path]/route.ts`; kit — `claude/mia-episode-companion/phone-capture/server.mjs`, `claude/mia-episode-companion/scripts/mia-listen.mjs`
**Origin**: Guillaume, 2026-10-18: "when she's going to talk to us, it really will need to be like in the mia-episode-companion … I record, she replies. There's even a queuing system for receiving the message. There's even something when you actually record, it sends on the server as a backup … So she's going to be able to explain to us these different parts of what she's actually doing. So if that could play at the same time that it highlights and it navigates through the diagram, I mean, that would be awesome."

## Creative Intent

**What this enables people to create:**
A spoken conversation about a design, held where the design is. The person looks at a drawing,
presses Record and says what they want; Mia, the session listening in that Chronicle episode,
hears the take together with what was on the canvas, and answers. Her answer is heard while the
canvas walks through it: each part of what she says opens its drawing and lights what it is
about, as she says it.

**Desired Outcomes:**
1. A person records a take from the designer the way they do from the phone page: one button, the
   recording backed up on the service as it is made, kept for Send again when a send fails
2. The take carries the canvas it was spoken at — the drawing, the system, the element in focus,
   the marks waiting on an agent — so the listening session hears what was being pointed at
3. A reply can be steps: each step names a drawing, what to light, and the words said there, and
   each step is voiced on its own
4. On the canvas, a reply with steps plays as a tour on the stage: the drawing opens, the elements
   light, that step's voice plays, then the next
5. Replies wait their turn as on the phone page: never over a recording, never over another reply,
   and a reply already in the thread when the page opened is shown, not played
6. The parts are reusable: any page that reaches a phone-capture service can record and play
   (`@miadi/stateloom-react`), and any host can show the conversation (`CompanionDock`)

## Why the phone page's conversation, and not a new one

The episode companion's phone page already holds a year of lessons, each paid for on William's
phone: a double tap that started two recorders; a failed upload that threw the recording away; a
reply that started playing in the middle of a take and cut it; a reply that arrived during another
and stopped it; iOS refusing a play that no tap asked for. The canvas reuses that conversation
instead of inventing one — the same service, the same episode, the same thread; a take recorded on
the canvas is read on the phone and the other way round.

What the canvas adds is the drawing. The phone page plays one voice for a reply; the canvas plays a
reply as a tour, so "this state" and "these two messages" are lit while they are said.

## Core Concepts

### A take with its canvas

The recorder (`createTakeRecorder`) is the phone page's state machine: idle → starting → recording
→ sending, and retry. While recording, what it captured is sent every 10 s to
`/api/takes/part?offset=<bytes held>` (a 409 answers with the offset the service holds); on Stop
the whole take goes to `/api/takes`. It records `audio/mp4` where the browser can, and WAV where it
cannot — the service takes no webm. A heartbeat to `/api/recorder` says the microphone is open, so
a reply posted then waits in silence.

Both calls carry `context=<json>`, what the canvas showed when Record was pressed
(`takeContext`): `stage`, `doc`, `kind`, `system`, `focus`, `visible`, `tour`, `who`, `at`, and
`marks` (the ids waiting on an agent on that drawing). The service keeps it as
`captures/<take>/canvas.json` (≤ 4096 characters); `mia-listen` reads it into the wake: "spoken at
the canvas: …".

### A reply with steps

The seat replies with `mia-listen reply --steps <file>`; the service stores up to 24 steps, each
`{say, title?, doc?, system?, focus?, spotlight?, region?}` — the Spec 83 step, with absolute
paths. The reply's text defaults to the steps' words joined. Each step is voiced on its own
(`audio/<reply>/step-<n>.mp3`, served at `/api/replies/<id>/steps/<n>/audio`, rendered on demand
when asked for before it exists); the reply's own audio is the steps' voices in order, for the
phone page.

### The reply as a tour

`replyTour(reply, base)` turns a reply into a `TourDefinition`: its steps with their voice
addresses, or, for a reply without steps, one caption with the whole reply's voice. A reply the
service cannot voice (`unvoiced`) keeps its steps without recordings and is read for each step's
reading time.

The stage plays it with `present(tour, { voice, origin: "Mia" })` — a tour loaded from the page,
not from the hub. The `voice` given is the tour's own for as long as it is loaded: Mia's
recordings play even when the canvas's own voice is off, and a live step from an agent is still
heard (or read) in the page's voice. `present` answers `true` when the tour played to its end and
`false` when it was stopped or replaced — that answer drives the queue.

`browserVoice({ recordings: true, speech: false })`: a recording is played; a step without one is
held for its reading time, never spoken in a voice that is not hers. A recording that plays sets
its own length (a slow voice is not cut at the reading-time guess).

## The rules of the conversation

Taken from the phone page as they stand on 2026-10-18:

- Nothing plays while the person records or a take is being sent. Pressing Record while Mia speaks
  stops her; what waited after her plays once the take is sent.
- A reply that arrives while another plays waits for it to end ("Mia replied again at 14:02. It
  plays when this one ends.").
- A reply that arrives while recording waits until the take is sent.
- A reply already in the thread when the page opened is shown, not played.
- Once the person presses ▶ or ■, the waiting sequence is over: each reply plays when they choose it.
- "Play Mia's replies on the diagram as they arrive" is the phone page's autoplay, remembered in
  the browser.

## The canvas

The designer reaches the service through its own server: `/api/companion/*` passes the phone
page's calls to `STATELOOM_COMPANION_URL` — read the thread, the episodes, the health, the
recorder's state and the voices; send a take, its parts, a diagnostic, the heartbeat, a thumb, a
request to voice a reply. Bodies and audio stream both ways (ranged for the voices). A reply is
never posted through it: the service takes replies from its own host only, and every request the
proxy forwards carries `x-forwarded-for`, which is how the service tells a forwarded request from
its own seat's. `GET /api/config` says `companion: true` when the variable is set, and the dock
appears; `STATELOOM_COMPANION_EPISODE` names the episode when the page does not.

The episode is, in order: `?episode=`, the episode of the drawing when it lives in the chronicle
(`<root>/<episode>/diagrams/<file>`), `STATELOOM_COMPANION_EPISODE`, the service's default. The
dock's list changes it.

The dock sits bottom-left above the machine's zoom bar, and on a phone above the stage's caption
while one shows. Closed, it is one button that shows the clock while recording, 🔊 while Mia walks
the diagram, and how many replies are new. A reply with steps folds it while it plays: the board is
the show.

## Agents

The seat composes a reply as steps when what it says is about the drawings:

```bash
mia-listen reply <take> --steps reply-steps.json
```

with `reply-steps.json` an array of steps (`doc` absolute, or relative to the episode, where it
resolves; `spotlight`/`focus` in the document's own names; `say` one or two sentences each). With
steps, stdin may be empty: the reply's words are the steps'. The canvas line in the wake says which drawing and
element the take was spoken at; the stage skill (`stateloom-stage`) says how to light elements.

## Reuse

`@miadi/stateloom-react`: `createTakeRecorder`, `createCompanionThread`, `replyTour`,
`takeContext`, `companionUrl` — no React, tested in Node against a stand-in service and microphone;
`present` on the stage session. `@miadi/stateloom-canvas`: `CompanionDock`, props in and callbacks
out. A host needs a path to a phone-capture service (a proxy like this designer's, or the service's
own CORS list, `MIADI_PHONE_CAPTURE_CORS_ORIGINS`), and a stage to present on.

## Verification (2026-10-18, this container)

The real phone-capture `createApp` (stub transcriber, a voice of ffmpeg tones), the hub, and the
designer, driven by Chromium with a fake microphone at 1280×800 and 390×844, on the dev server and
on `next build` + `next start`: a 12-second take sent
one backup part and the whole take (`audio/mp4`, stored as `.m4a`) with its `canvas.json`; the
seat's three-step reply opened the sequence with two messages ringed, then the machine with
Published lit, then the ERD with two entities lit, each step's voice playing its full length
(4.6 s, 3.0 s, 4.2 s) with a breath between; a second reply posted 4 s later played only after the
third step ended. `POST /api/companion/replies` answered 403.

## Structural Tension

**Current reality (before this spec)**: a person spoke to Mia from the phone page and heard one
voice per reply; the canvas could show an agent's steps (Spec 83) but had no voice of hers and no
way to speak back except typing a mark.

**Desired outcome**: the person speaks about what is on the canvas, and Mia's answer is heard while
the canvas walks through it — with the phone page's backup, queue and courtesy intact.

**Next (not built here)**: the phone page playing a reply's steps as a list it scrolls through as
they are heard; a take recorded while a tour step is shown carrying that step; replies voiced by
`miadi-voice` per step for an agent's own tours (Spec 83's next); the reply's steps checked against
the drawings before they are posted (names that do not exist light nothing).
