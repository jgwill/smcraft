# 78 — Forgewright renders episode state-machines (PLAN)

> Plan only (HANDOFF v2, Phase 2 deliverable 3). No forgewright deployment, no ilex
> changes happen from this document. It exists so the forgewright lane can lift it
> into `forgewright/rispecs/` (natural slot: spec 12, after 11-chronicle-narrative-beats)
> and act on it deliberately.

## Desired outcome

Forgewright's chronicle section (`/workspace/repos/miadisabelle/forgewright`, runs on
ilex port **8031**) shows which miadi-chronicle episodes carry designed state-machines
and renders them — read-only first, live canvas hosting later.

## Current reality (verified 2026-07-26)

- **The convention exists and is proven.** `<episode>/diagrams/<name>.smdf.json` —
  first inhabitant: `2026-06-28-episode-103-film-preprod-report-phase-2/diagrams/film-preprod.smdf.json`,
  woven live through hub 4599 with the path chosen via the miadi-stateloom MCP
  (`set_project_file`, Spec 73 "Path Power").
- **Forgewright already consumes the loom.** `package.json` depends on
  `@miadi/stateloom-{client,protocol,react}` ^0.1.0 and `smcraft` ^0.3.0, and
  `src/lib/smcraft/forgewright-bridge.ts` exists. The dependency arm of the
  absorb-or-depend question is already in motion.
- **The chronicle section is read-only by design.** `src/lib/chronicle/` derives views
  from what the medicine-wheel service serves and persists nothing (spec 11). The
  medicine-wheel it talks to is the **ssh-tunnel service on ilex port 8040** started
  from `gmtermux/scripts` — NOT the docker one at `mw.tail3b11eb.ts.net`.
- Episodes reach ilex through the episodes git remote
  (`ilex:/data/data/com.termux/files/srv/git/episodes.git`).

## Phase A — read-only rendering (first motion)

1. **Discovery.** A chronicle episode view asks one question: does
   `<episode>/diagrams/*.smdf.json` exist? Two candidate answers, choose ONE:
   - *Filesystem route* — a forgewright API route (`/api/chronicle/diagrams?episode=…`)
     globs the episode folder on the host that serves 8031. Cheapest; couples
     forgewright to a chronicle working tree on ilex.
   - *Wheel route* — register each committed diagram as a medicine-wheel artifact
     (`miadi.artifact-ref.v1`, new kind `state_machine_diagram`) the way
     `src/lib/chronicle/client.ts` already lists artifact kinds. Keeps forgewright's
     "read only what the wheel serves" purity; needs a small registration step
     (inquiry-weave `register` is the precedent).
   Recommendation: start filesystem (prove the render), migrate to wheel artifacts
   when the registration ceremony exists.
2. **Render.** A read-only `SmdfDiagram` component: parse the SMDF (`smcraft` /
   `@miadi/stateloom-protocol` types are already installed), lay out states and
   transitions. No editing, no sockets — the file is the truth. Slot it into
   `src/components/chronicle/` beside `NarrativeBeats.tsx`.
3. **Tests.** Vitest over the SMDF→view derivation (pure, like `beats.ts`), fixture:
   the ep103 film-preprod machine.

## Phase B — live canvas hosting (later, explicitly not now)

- Forgewright already has `@miadi/stateloom-react`; a live canvas is
  `createBridgeSession({ url: <hub>, docId: <episode path> })` plus the join-ack
  hydration fixed in this handoff's Phase 1.
- The open question is WHERE the hub runs for ilex: 4599 today binds 127.0.0.1 on
  gaia. Options: a hub on ilex itself (termux node), or a tunnel following the
  8040 pattern in `gmtermux/scripts`. That decision belongs to the gmtermux/ilex
  owner — not taken here.

## The long arc — absorb or depend

William's framing: forgewright either absorbs smcraft or uses it as dependencies.
Current reality has already chosen the near-term answer: **consume
`@miadi/stateloom-*` as published packages** (forgewright does this today).
Absorption into miadi proper remains open and is Guillaume's call; nothing in
Phase A/B forecloses it, because every touchpoint goes through the published
package surfaces, not smcraft internals.

## Hard boundary restated

Nothing in this plan deploys to forgewright or ilex. Rendering work happens in the
forgewright repo by its own lane, on its own consent, with this plan as input.
