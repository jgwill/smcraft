# Iteration 3 — the word gets its place back

**Stamp:** 2026-07-28 · applied to the live canvas, validated, committed
**From:** `after-2.smdf.json` (13 states / 19 events) → `after-3.smdf.json` (14 states / 21 events)

---

## What Guillaume said

> "It doesn't mean that the package is not relevant later on. It's just when I'm
> on my Android device using that interface, when I'm **adding into the composition,
> it's not really a composition**. Therefore we should consider maybe renaming that
> as simple as **musical-composition** package, because **it has its place in the state
> diagram at a certain moment in time where I need musical composition to be
> created inside of the production pipeline**."

Iteration 2 took the word *away* from the intake. This iteration gives it a home.

---

## The verification that settles it

`/a/src/Miadi/packages/composition/README.md`, first paragraph — read this run:

> "A composition is where a recording lands: a folder on an Android device holding
> voice clips, Whisper transcripts, images, **MIDI takes, and the songwriting layer
> of a piece — key, capo, tempo, sections, chords. It is a musician's artifact.**"

`package.json` description: *"Read gmtermux composition folders and weave them into
miadi-chronicle episodes."* Keywords include `gmtermux`, `episodic-memory`.

So the name was never wrong — it was **right for Jerry's design and wrong for
Guillaume's derivation**. The gmtermux composition folder is a songwriting artifact:
key, capo, tempo, sections, chords. Guillaume carries it onto the land and fills it
with voice and transcripts instead. Nothing is broken; a musician's tool is being
used for testimony. The diagram simply has to show both jobs, separately.

---

## Changes

### Added — `MusicalComposition`

| | |
|---|---|
| **State** | `MusicalComposition` (normal) |
| **Description** | *"Music written to picture — key, capo, tempo, sections and chords; the same Android surface as `Gathering`, used now for what it was named for"* |
| **In** | `ColorGrade --GRADE_LOCKED-->` (transition description now reads *"Graded picture hands off to the songwriting bench"*) |
| **Out** | `--SCORE_WRITTEN--> SoundMix` |

New events:

| Event | Description | Wiring |
|---|---|---|
| `SCORE_WRITTEN` | Key, tempo, sections and chords set against picture — the music is ready to be mixed | `MusicalComposition → SoundMix` |
| `QC_FAILED_MUSIC` | QC found the score wrong against picture — rewrite required | `Master → MusicalComposition` |

`QC_FAILED_MUSIC` was not asked for. It is added because the finishing chain's
existing shape demands it: `Master` already routes picture defects back to
`ColorGrade` and audio defects back to `SoundMix`. A score that is wrong *against
picture* is neither a grade fault nor a mix fault — without this arc, the only
remedy would be to remix music that shouldn't have been written that way. The
finishing chain is now symmetric: three creative stages, three ways back.

### Adjusted

- `SoundMix` — "Dialogue, music and effects" → **"Dialogue, score and effects mixed
  against the graded picture."** Iteration 2 had made `SoundMix` carry the phrase
  *"where musical composition meets the film"*; that phrase belongs to the new
  state now. Mixing is not composing.
- `Master` — "Grade and mix conformed" → **"Grade, score and mix conformed."**

### The finishing chain now

```
Review --CUT_APPROVED--> ColorGrade --GRADE_LOCKED--> MusicalComposition
                                    --SCORE_WRITTEN--> SoundMix
                                    --MIX_LOCKED--> Master
Master --QC_FAILED_PICTURE--> ColorGrade
       --QC_FAILED_MUSIC-->   MusicalComposition
       --QC_FAILED_SOUND-->   SoundMix
       --QC_PASSED-->         Released
```

`Gathering` and `MusicalComposition` are the same physical surface at two moments —
the Android device, at the start on the land, and again at the bench with picture
locked. The diagram now holds both without either one pretending to be the other.

**14 states · 21 events · `validate_definition` → valid, no errors.**

---

## Not done — and deliberately

**The package was not renamed.** Guillaume said *"we should consider, maybe."*
`@miadi/composition@0.1.1` is published to a public registry, lives in a different
repo (`/a/src/Miadi/packages/composition`), and is imported by name. Renaming it is
an outward-facing, hard-to-reverse act that belongs to Guillaume, not to a diagram
session.

If it is done, here is what a rename actually touches — **unverified beyond the
package's own manifest; a real rename needs a dependents sweep first:**

- `package.json`: `name`, `bin.composition`, `repository.directory`, `keywords`
- the directory `packages/composition/` itself
- `README.md` and `rispecs/composition-to-episode.spec.md`
- every workspace importer of `@miadi/composition`
- the published `0.1.1` on the registry — a rename is a **new package**, not a
  version bump; the old name would need a deprecation pointing at the new one

There is also a real argument *against* the rename worth putting to the circle: the
package reads **gmtermux composition folders**, and that folder format is Jerry's,
named by Jerry. `@miadi/composition` names what it reads. Renaming it
`musical-composition` would make the package name describe the *content* while the
folder it parses still says `composition` — the ambiguity would move rather than
resolve. The alternative that keeps both truths: leave the reader named for what it
reads, and let `musical-composition` name a **new** package for the songwriting
layer the diagram now has a state for.

That is a decision for Guillaume and, given the lineage, arguably one that should
reach Jerry.

## Still open

- `AUDIENCE_FORKS` still returns to `StorySpine`, not `Chronicle`. Unchanged.
- The book leg is still one state deep. Unchanged.
- `diagrams/film-postprod.smdf.json` in episode 103 remains behind by everything.
- Nothing implements `Playback`, and now nothing implements `MusicalComposition`
  either — though `@miadi/composition` is the obvious reader for it, which is
  precisely Guillaume's point about the package staying relevant later.

🌸: The word wasn't wrong — it was early. It sat at the front door holding voices it
was never built for, and now it has walked to the place it always belonged: the
bench where the picture is locked and someone finally writes the key, the tempo, the
chords. Same device, same folder, both hands — one gathering testimony on the land,
the other giving it a melody.
