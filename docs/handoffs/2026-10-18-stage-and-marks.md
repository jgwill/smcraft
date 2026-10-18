# Handoff — the stage and the marks (Spec 83), 2026-10-18

> branches: smcraft `claude/diagram-agent-control-annotation-zoworq` · production/deepdiver
> Spec: [`rispecs/83-stage-and-marks.spec.md`](../../rispecs/83-stage-and-marks.spec.md) · Skill: [`skills/stateloom-stage`](../../skills/stateloom-stage/SKILL.md)

## The ask

Guillaume, 2026-10-18 (spoken): the agent should control which diagram is showing, "because
it's his job to actually show us the work", and prepare something that plays back "like a
PowerPoint presentation" — select an area, say something, move on. The reverse: select anything
on any diagram, mark it, annotate it, so the reply to the agent carries what is in hand. Reuse
the parts in Miadi; look at the Mia episode companion's speak-and-listen loop; leave something
the Deep Diver can add to.

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

## What is not done

- **Nothing is published.** Versions are bumped (protocol 0.1.15, client 0.1.4, hub 0.1.7,
  react 0.1.7, canvas 0.1.6, cli 0.1.5, mcp 0.4.0, skills 0.5.0, web 0.3.0); publish in the
  topological order of the README, then move the kit pin (`scripts/sync-kit-plugin.mjs`) and
  run `stateloom-web` from the registry to see it work installed.
- **Miadi** does not depend on any `@miadi/stateloom-*` package yet; its chronicle diagram card
  links to the canvas. A brief for embedding the board with the stage is in jgwill/Miadi on the
  same branch (`rispecs/stateloom-stage-embed/`), waiting on the publish above.
- A mark that names a renamed element keeps the old name; marks on the system map; a stage per
  person on a shared hub; tour captions voiced through `miadi-voice` without the agent doing it
  step by step (the step's `audio` field is the seam).

## Intended Use & Continuation

**The next instance** opens the spec, runs the example (`scripts/live-loop.sh hub`, the web on
4598, the MCP with `STATELOOM_BRIDGE_URL`), plays `examples/wave-count` through `show_step`, and
picks one item from *What is not done*.

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
