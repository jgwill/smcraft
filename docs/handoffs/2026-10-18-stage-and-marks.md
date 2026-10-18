# Handoff — the stage and the marks (Spec 83), 2026-10-18

> branches: smcraft `claude/diagram-agent-control-annotation-zoworq` · production/deepdiver
> Specs: [`rispecs/83-stage-and-marks.spec.md`](../../rispecs/83-stage-and-marks.spec.md), [`rispecs/84-talking-on-the-canvas.spec.md`](../../rispecs/84-talking-on-the-canvas.spec.md) · Skill: [`skills/stateloom-stage`](../../skills/stateloom-stage/SKILL.md)

## The ask

Guillaume, 2026-10-18 (spoken): the agent should control which diagram is showing, "because
it's his job to actually show us the work", and prepare something that plays back "like a
PowerPoint presentation" — select an area, say something, move on. The reverse: select anything
on any diagram, mark it, annotate it, so the reply to the agent carries what is in hand. Reuse
the parts in Miadi; look at the Mia episode companion's speak-and-listen loop; leave something
the Deep Diver can add to.

Then, the same day: "when she's going to talk to us, it really will need to be like in the
mia-episode-companion … I record, she replies … a queuing system … when you actually record, it
sends on the server as a backup … if that could play at the same time that it highlights and it
navigates through the diagram, I mean, that would be awesome." That is Spec 84.

## Aspects

1. **The stage** — an agent puts a step on the canvas (a drawing, what to light in it, a
   sentence beside it) or hands it a tour (`.tour.json`) to play with its own controls.
2. **The marks** — a person marks elements or an area of any drawing and says what the agent
   should know; the agent reads it before replying and answers in the thread on the drawing.
3. **The wake** — a session waits for the person's next mark the way the companion waits for a
   spoken take: `smcx marks await` as a background task, or `await_marks` in a tool call.
4. **Reuse** — the layer, the caption and the cards are components in `@miadi/stateloom-canvas`;
   the session is `useStage` in `@miadi/stateloom-react`. Any host with a viewport and the
   protocol's boxes can present.
5. **Talking (Spec 84)** — the person records a take from the designer into the episode
   companion's thread, with what the canvas showed; Mia's reply, written as steps, plays as a tour
   on the stage, each step's drawing opened and lit while its own voice plays. The phone page's
   backup parts, queue and courtesy rules hold.

## Results

Measured in this container against a live hub (4599) and the designer (4598) on the wave-count
example, driven by Playwright as the person and by the MCP server over stdio as the agent:

- A three-step tour written with `write_tour` and played with `play_tour` opened the sequence
  with two messages ringed and the rest dimmed, drilled the machine to the lit states, and fitted
  two ERD entities above the caption; `stage_control goto 3` and `stop` moved and cleared it.
- A person's ✎ tap on an ERD attribute row wrote `elliott_wave_count.erdf.marks.json`; the
  agent's reply arrived in the pinned thread without a reload; `add_mark` pinned the agent's
  question (violet) and counted it on 💬.
- `smcx marks await` exited 0 with `NEW MARK FROM GUILLAUME`, the context, and the reply and
  re-arm commands, two seconds after the person marked a state through `/api/marks`.
- On a 390-px phone the caption sits above the dock and a step fits its spotlight.
- Tests: protocol 167, client 3, hub 13, react 16, cli 14, skills-cli 26, mcp 44 of 45 — the
  one failure is R10 (`system.test.ts`), which expects EACCES on a read-only file and gets none
  because this container runs as root; it does not touch the stage. `next build` passes.

Spec 84, measured the same way with the real phone-capture `createApp` (stub transcriber, ffmpeg
tones as the voice, a seat that answers each take with three steps), Chromium with a fake
microphone, at 1280×800 and 390×844, on the dev server and again on `next build` + `next start`:

- A 12-second take sent one backup part (`/api/takes/part?offset=0`) and the whole take
  (`audio/mp4`, stored `.m4a`) with `canvas.json` (drawing, system, kind, visible area).
- The reply opened the sequence with messages 7 and 8 ringed, then the machine with Published
  lit, then the ERD with WaveCount and TradeSetup lit; each step's voice played its full length
  (4.6 s, 3.0 s, 4.2 s) with a breath between; a second reply posted 4 s later played only after
  the third step ended.
- `POST /api/companion/replies` answered 403. The dock folds while a reply walks the board, stands
  above the machine's zoom bar, and on a phone above the caption.
- Tests: react 22 (5 companion), phone-capture 44, mia-listen 14.

## Elsewhere, same branch name

- **jgwill/miadi-orchestration-kit**: `miadi-stateloom` 0.2.0 carries `stateloom-stage`,
  `/stage-present` (draft a tour, one pass of the `tour-editor` agent, write, play) and
  `/stage-listen` (`smcx marks await` in the background, each mark answered in its thread); its
  MCP pin stays at the published 0.3.5 until 0.4.0 is out (`STATELOOM_MCP=<smcraft>/mcp` meanwhile).
  `mia-episode-companion` 0.5.0: Mia's wake says what is on William's canvas and which marks wait;
  phone-capture 0.3.0 keeps a take's canvas and voices a reply's steps one by one;
  `mia-listen reply <take> --steps <file>`. `miadi-stateloom` 0.2.1 carries the skill's
  section on answering a take with steps.
  `miadi-deepdiver` 0.3.0: `/notebook-from-handoff`, which takes this file.
- **jgwill/Miadi**: the chronicle diagram card counts the marks on its drawing;
  `rispecs/stateloom-stage-embed/` plans the board and the stage inside the episode.

## What is not done

- **Nothing is published.** Versions are bumped (protocol 0.1.15, client 0.1.4, hub 0.1.7,
  react 0.1.7, canvas 0.1.6, cli 0.1.5, mcp 0.4.0, skills 0.5.0, web 0.3.0); publish in the
  topological order of the README, then move the kit pin (`scripts/sync-kit-plugin.mjs`) and
  run `stateloom-web` from the registry to see it work installed.
- **Miadi** does not depend on any `@miadi/stateloom-*` package yet; its chronicle diagram card
  links to the canvas. A brief for embedding the board with the stage is in jgwill/Miadi on the
  same branch (`rispecs/stateloom-stage-embed/`), waiting on the publish above.
- **The kit pin.** `scripts/sync-kit-plugin.mjs` writes `mcp/package.json`'s version into the
  kit's `.mcp.json`; run before the publish, it pins an MCP that is not on npm (it did, on this
  branch, and the pin was put back to 0.3.5). Run it after publishing, or restore the pin.
- **Talking**: a reply's steps are not checked against the drawings before they are posted (a
  name that does not exist lights nothing); the phone page plays a stepped reply as one voice and
  does not scroll its steps; a take recorded while a tour step is shown does not carry the step.
- A mark that names a renamed element keeps the old name; marks on the system map; a stage per
  person on a shared hub; tour captions voiced through `miadi-voice` without the agent doing it
  step by step (the step's `audio` field is the seam).

## Intended Use & Continuation

**The next instance** opens the specs, runs the example (`scripts/live-loop.sh hub`, the web on
4598, the MCP with `STATELOOM_BRIDGE_URL`), plays `examples/wave-count` through `show_step`, and
picks one item from *What is not done*. For Spec 84, start the phone-capture service
(`ensure.sh`, or `createApp` with a stub transcriber), set `STATELOOM_COMPANION_URL` on the web,
record from the 🎙 dock, and answer with `mia-listen reply <take> --steps`.

**The Deep Diver path.** Feed this handoff, Spec 83 and the skill into a notebook and ask it
the questions below. The media it should make: an infographic of the two directions on one
drawing (the agent lighting and saying; the person marking and saying), and a short video
overview of a tour played over the wave-count system with a mark answered in its thread. The
notebook's answers are its reading, not verified facts; the measurements above are.

### Open inquiries for the community

1. What does a person need from a walkthrough of a design they did not draw — an order, a
   voice, the freedom to stop and point — and which of these does a tour over the real
   drawings give that slides of screenshots do not?
2. When a person points at elements and an agent answers on the drawing, where should the
   conversation live so the next person and the next instance find it: beside the drawing (as
   here), in the episode, in the medicine wheel as relations between a person, a question and
   an element?
3. How should an agent decide between showing one step while it talks and preparing a tour —
   and what makes a tour worth keeping after the session that made it?
