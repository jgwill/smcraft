# Sub-agent recommendation — interactive-storytelling reframe

- **Run:** 2026-07-27 19:46 (`2607271946`)
- **Agent id:** `a0f0e9ee8811b00a2` (general-purpose, resumable via SendMessage)
- **Cost:** 94,086 subagent tokens · 20 tool uses · 249s
- **Brief:** advisory only — survey the actual platform, recommend two names, recommend the minimum interactive-storytelling adaptation.

---

## FOUND

| Path | Exists | What's actually there |
|---|---|---|
| `/workspace/repos/jgwill/smcraft/rispecs/70-smdf-format.spec.md` | ✅ | SMDF schema. `StateDef` = `name, states[], transitions[], onEntry/onExit, parallel, description`. 14 validation rules. |
| `/workspace/repos/jgwill/smcraft/mcp/src/server.ts:731` | ✅ | `kind: z.enum(["normal","final","history"])` — **there is no `"initial"` kind.** First child is implicitly initial (`py/smcraft/parser.py:170-182`). |
| `…/mcp/src/server.ts` `add_transition` | ✅ | Supports `condition` (guards) and `description`; **`nextState` is optional → internal/self transitions are legal.** |
| `…/ts/src/parser.ts:166`, `web/src/store/useDesignerStore.ts:297` | ✅ | V007 "Final state must not have outgoing transitions" — a *warning* in the runtime, an **error** in the designer store. |
| `…/rispecs/74-web-designer.spec.md:41` | ✅ | Composite drill-down exists in the store (`currentParent`, `navigationPath`) but "Composite states: dashed border (currently same as final — needs distinction)". |
| `…/mcp/src/server.ts:674` | ✅ | `generate_rispec` emits "no terminal state declared yet" when zero `final` states exist. |
| `/srv/miadi/…/episode-103-…/diagrams/` | ✅ | `film-preprod.smdf.json` (ns `miadi.chronicle.ep103`, name `FilmPreprod`) + `film-postprod.smdf.json`. **The repo's `statemachine.smdf.json` is the same file, ahead by the whole `OnTheLand` arc** (diff = LAND_CALLS, KNOWLEDGE_RECEIVED, OnTheLand). README declares `diagrams/` the durable truth — the episode copy is stale. |
| `…/episode-103-…/composition.json` | ✅ | The episode's ingest artifact: `clips[]` (`260628174942.m4a`) + `texts[]` (Whisper transcriptions). |
| `…/transcription_20260628223300_EN.txt` | ✅ | **Guillaume, in this episode:** *"in my film I want it to be, yes, it was going to be a master, but somehow it's going to be possible for some of the people to fork and to do their own narrative."* Also: *"Identify thematic structures implied meaning story spine."* |
| `/a/src/Miadi/packages/passages` | ✅ | "Narrative formulation engine… transforms chronological events and **branch-map** data into interactive story formats (Twine/Twee). A **Passage** is a structured unit of narrative representing a specific branch, chapter, or moment in time." |
| `/a/src/Miadi/packages/composition` (`@miadi/composition@0.1.1`) | ✅ | "A composition is where a recording lands: voice clips, Whisper transcripts, images, MIDI takes." |
| `/a/src/Miadi/packages/voice` (`@miadi/voice@0.1.1`) | ✅ | Edge-TTS producer + ledger + `assembly.voice.ready` — the "listen to a media" surface. |
| `/a/src/Miadi/packages/inquiry-weave/src/story-library.ts:18` | ✅ | `DEFAULT_STORIES_ROOT = "/home/mia/Documents/Twine/Stories"` (Twine shelf enumerator). |
| `/workspace/repos/miadisabelle/gmtermux` | ✅ | 4 portals; Clipboard Gallery does TTS playback, Workspace Portal plays audio/video/MIDI inline. `scripts/weave-composition.sh`. |
| `/usr/local/src/mightyeagle/packages` | ✅ | Same package set as `/a/src/Miadi/packages` (mirror). |
| `/a/src/Miadi/packages/ncp-story-studio` | ⚠️ | Exists but is **empty** — only `.hch/` issue stubs. No code. Do not build on it. |

## NAMES

| Slot | Recommend | Grounding | Runner-up (why it lost) |
|---|---|---|---|
| `Ingest` → | **`Composition`** | `@miadi/composition@0.1.1`: "where a recording lands — voice clips, Whisper transcripts, images, MIDI." ep103's own ingest artifact is literally `composition.json` holding the clip + transcriptions. Same job as Ingest: media managed, transcribed, made addressable. | `Capture` — gmtermux's Pixel Recorder/Clipboard Gallery name the *act*; the state must name the durable artifact everything downstream reads. |
| `Assembly` → | **`StorySpine`** | Guillaume's own words in the ep103 transcript that owns this diagram: *"Identify thematic structures implied meaning story spine."* A spine is where every rib attaches and every fork branches off — it survives the 3-inbound (soon 4) convergence test better than any weave metaphor. | `PassageWeave` — accurate to `passages` (branch-map → Twine), but a weave has no center; the hub needs one. |

## ADAPTATION

Ranked by confidence.

1. **Rename, and update all 3 inbound `nextState` refs in the same edit.** `Ingest`→`Composition`, `Assembly`→`StorySpine`. Callers: `MEDIA_VERIFIED` (Composition), `CHANGES_REQUESTED` (Review), `KNOWLEDGE_RECEIVED` (OnTheLand). *V006 fails the document if any one is missed.* **High confidence.**

2. **`Released.kind`: `"final"` → `"normal"`.** The transcript puts the fork *at the master* — so `Released` must emit, and V007 forbids that on a final. Interactive production is genuinely cyclic; it has no terminal. **High confidence.** *Known cosmetic consequence:* `generate_rispec` will then say "partially modeled; no terminal state declared yet" (`mcp/src/server.ts:674`). Accept it rather than inventing a fake terminal.

3. **One new state, flat — not nested.** `Playback` (normal): *"The audience is inside the media — listening, moving through it in time."* Nesting is supported but composites render with the same dashed border as finals (`rispecs/74-web-designer.spec.md:41`), so a nested fork region would be visually ambiguous on the canvas today. A composite also buys nothing: the fork's exit target is outside it. **High confidence.**

4. **Three events, three transitions.**
   - `LISTENER_ARRIVES` — *"Someone presses play — the master finds an audience"* → `Released → Playback`
   - `PASSAGE_TURNS` — *"The listener moves on — the media advances, the story holds"* → `Playback`, **internal** (omit `nextState`; legal per `add_transition`). This is the verified-cheap way to express "as you progress" with zero new states; the unit name comes from `passages`.
   - `AUDIENCE_FORKS` — *"A listener leaves the master line to author their own narrative"* → `Playback → StorySpine`. **This is the change that proves the name:** the forker becomes an author, and authoring converges at the spine — a 4th inbound arc. **High confidence.**

5. **`OnTheLand` does not change — deliberately.** Do *not* wire `Playback → OnTheLand`. OnTheLand is the *producers'* off-screen relational path; the fork is the *audience's*. Collapsing them would demote a relational commitment into a UX feature. **High confidence.**

6. **`settings.name`: `PostProduction` → `InteractiveProduction`.** It is no longer post-only once playback and forking are inside it. **Medium.** Namespace: leave `Film` — or align to `miadi.chronicle.ep103` to match its sibling `film-preprod.smdf.json`. **Low confidence / optional; his call.**

Net: 2 renames, 1 kind flip, 1 new state, 3 new events, 3 new transitions. Nothing removed.

## RISKS

- **Unverified:** whether the live designer canvas re-renders cleanly on a state *rename* (the bridge emits `state.add`/`transition.add` ops — I saw no `state.rename` op). Renaming may require remove+add, which would drop the state's persisted layout position (rispec 79). **Check this before editing through the MCP.**
- **Unverified:** whether V007-as-error in `useDesignerStore.ts:297` blocks saving or only annotates. If it only annotates, step 2 could in principle be deferred — but I would not.
- **Real, not a risk — a divergence:** the episode's `diagrams/film-postprod.smdf.json` is behind the repo working copy by the entire OnTheLand arc. Per that directory's own README the episode copy is the durable truth. Whatever gets decided here should land there, not only in the repo root.
- **Unverified:** `@miadi/voice` / gmtermux portals are the plausible playback runtime for `Playback`, but I found no code binding either to an SMDF machine. The state models the intent; nothing implements it yet.
