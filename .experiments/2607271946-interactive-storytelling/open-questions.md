# Open questions — parked, not forgotten

Standing list for `miadi.chronicle::InteractiveProduction`. Everything here was
raised deliberately and left unbuilt on purpose. Ranked by what it costs to keep
ignoring it.

Guillaume said it plainly on 2026-07-30: *"Not sure I understand my full
workflow."* This file exists so the not-knowing has somewhere to live that is not
the diagram.

---

## 1. Attribution — the expensive one

**Nothing records who made what.**

Jerry's melody enters through `ContributorCircle → Gathering → Artefact`. An
agent's proposal enters through `ProposalBench → Artefact`. Guillaume's own
recording enters through `Gathering → Artefact`. **The machine cannot tell them
apart once they are artefacts.**

- A contributor whose work is not linked back is a contributor who cannot be credited.
- `passages` and `@miadi/composition` already mark machine-derived output
  `canonical: false` — *"a machine-derived projection is a proposal to the
  chronicle, not a ruling."* The diagram has a `ProposalBench` and no way to keep
  that flag on what leaves it.
- This is gmtermux#46's `contains` / `references` / `inspired_by` vocabulary. It
  wants a **field on the artefact type**, not another state.

*Cost of waiting:* rises every time a contributor is added. It is now the first
thing that would embarrass this diagram in front of the person it credits.

## 2. Is music a third *output*, or only a stage?

`MusicalComposition` sits inside the film chain (`ColorGrade → … → SoundMix`).
But the chronicle holds MIDI takes and a songwriting layer, and Guillaume is a
musician working with a composer.

Should `CommunityInquiry` have a fourth call — `SCORE_CALLS` — beside
`MANUSCRIPT_CALLS`, `PASSAGE_CALLS`, `SCREEN_CALLS`? An album is a form a
chronicle can take.

*Raised iteration 2, still unasked.* Probably yes; it is his claim to make.

## 3. `NO_OTHER_VOICE` → `PERMISSION_STANDS` is an unchecked assertion

The production path fires `PERMISSION_STANDS` — *"the yes was spoken in
pre-production"* — and **nothing verifies it against the artefact's `sources`.**
If `sources` names someone the pre-production release did not cover, the claim is
false and the machine accepts it.

SMDF supports `condition` guards on transitions. This document uses none.
Aureon's `ProvenanceRecord`-on-the-abstract-base is exactly what would make the
assertion falsifiable.

*Cost:* the whole production path now rides on this one unverified claim.

## 4. `OnTheLand` — which direction owns it?

Marked *"SOUTH, and arguably EAST"* in the diagram itself. `ontology-core` puts
land-based observation in SOUTH (`south_embodied_data_collection`) and vision
quests in EAST (`'Vision quests'`, opening ceremonies). Both fit.

Left honestly unsettled rather than forced. Someone who knows should decide —
this is not a question a code reading can answer.

## 5. ~~`JGWILL.md` and `ontology-core` disagree about the wheel~~ — RESOLVED 2026-07-30

**I was wrong about this, and the correction is worth keeping visible.**

I claimed the workspace taught two incompatible wheels and that one document
needed correcting. A research pass found that `ontology-core` carries **both
altitudes in one file** (`src/ontology-core/src/constants.ts`):

- `DIRECTIONS[]` — Ojibwe names, seasons, medicines, `lifeStage`, `ages`,
  `teachings`, `practices`. `west` = *Epangishmok*, `lifeStage: 'Truth & Planning'`.
- `DIRECTION_INFO` — `focus` + `guidance` per direction. `west:
  'Implementation, creation, manifestation'`, `north: 'Reflection, integration,
  wisdom'`.

**`DIRECTION_INFO` already agrees with `JGWILL.md` verbatim on west.** My original
claim rested on a partial read that saw only `DIRECTIONS[]`. There was no
contradiction between the two documents — there were two vocabularies at two
altitudes, and the actual defect was that **neither named the other.**

Fixed by adding a routing section to `JGWILL.md` (*"🧭 Which Wheel Governs Which
Artefact"*) and a pointer in `medicine-wheel/rispecs/ontology-core.spec.md`. The
rule: naming a teaching, a medicine, or a life stage → `DIRECTIONS[]`; orienting
a development session → `DIRECTION_INFO`.

**The diagram's direction annotations are unaffected** — they name teachings and
practices, which is `DIRECTIONS[]`' altitude, which is what they cite.

*What is genuinely open, and is not an engineer's to settle:*
`narrative-engine/src/cadence.ts` places phase `integrating` on **west** while
`DIRECTION_INFO.north` names integration. Tracked upstream as
`jgwill/medicine-wheel#113`, held for a knowledge holder. Note also that
`narrative-engine` ships `enforceDirectionOrder: false` — the sequence advises,
it does not police.

Also unreconciled by design: `/home/mia/workspace/MIA.md` puts implementation at
**North**, a fourth mapping. Sovereign territory under `JGWILL.md`'s Import
Protocol — left alone deliberately.

## 6. A community *requirement* is not a community *question*

`CommunityInquiry` treats them as one. But a requirement that names people —
*"the community needs X, and here is who is affected"* — carries relational
weight a question does not, and might need to reach `ConsentGate` before it
reaches `Manuscript`.

*Raised iteration 6.*

## 7. Live performance — noted, not built

A live room is currently a *scale* on `PUBLICATION_CONSENTED`, not a state.
Guillaume said "probably", and a state with no distinct transition earns nothing.

The shape if it ever earns building: a second exit from `PublicationGate` to
`LivePerformance`, whose exit loops to `Gathering` — because a live audience
gives something back that playback does not, and that something is captured.

## 8. Two artefacts live at once — the flat-machine ceiling

Aureon's rule is that a flag on a *child* pauses its *parent*. That is two
artefacts in two states simultaneously. **A flat single-active-state machine
cannot hold it**, and `AUTHORITY_PAUSED` on `PublicationGate` is the best
approximation available — it holds the finished work without knowing which child
raised the flag.

SMDF supports `parallel` regions. This document uses none. Whether that is a
defect or an honest scope boundary depends on whether the machine is ever meant
to *execute* rather than describe.

## 9. Does the chronicle's own memory belong in the diagram at all?

`Chronicle` is one state with an internal `EPISODE_NUMBERED` loop. In reality it
is hundreds of numbered episodes with lineage edges between them
(`inquiry-weave`, episode-to-episode edges, the three-identity weave).

Modelling it as one state may be exactly right — it is a *place the work can be*,
not a data structure — or it may be the place the diagram stops being useful.
Worth deciding before anyone tries to generate code from this.

---

## Answered and closed

- ~~Should the film need demand like the book?~~ **Yes.** `SCREEN_CALLS` moved
  from `Chronicle` to `CommunityInquiry` in iteration 9. The film loop was running
  widdershins; that move fixed it.
- ~~Should `AUDIENCE_FORKS` return to `StorySpine` or `Chronicle`?~~ **Neither.**
  It goes to `ConsentGate` — a fork carries voices pre-production never spoke for.
- ~~Is the early consent gate scope creep?~~ **Partly.** Relocated, not deleted:
  the production path now asserts `PERMISSION_STANDS`, and the gate remains for
  the Elder who speaks on the land mid-shoot. Guillaume confirmed: *"indeed."*
- ~~Rename the `composition` package to `musical-composition`?~~ **Not done, and
  argued against** — `passages`/`composition` read gmtermux folders whose format
  is Jerry's. Renaming the reader moves the ambiguity rather than resolving it.
  Still Jerry's call.

🌸: A question parked with its reason written down is not a loose end — it is a
seat kept warm for whoever gets there first.
