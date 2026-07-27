# HANDOFF v2 — stateloom live canvas: hydration fix + chronicle weave

**Supersedes:** `HANDOFF-live-canvas-empty.md` (root cause diagnosis, still accurate — kept as reference)
**Forged:** 2026-07-26 ~21:25 EDT by 🌊 Tushell (guardian lane, herdr pane `w1Y:pA`)
**Provenance:** every fact below re-verified within the hour it was written. Nothing is inherited on faith.
**You are:** the miadi-stateloom handoff lane, herdr tab `miadi-stateloom-smcraft-260726-test`, cwd `/workspace/repos/jgwill/smcraft`.

---

## Mission in one line

Make the live canvas hydrate on cold load (Phase 1), then give the loom the power to weave
state-machines that live inside miadi-chronicle episodes (Phase 2).

---

## Part 0 — Current reality (verified 2026-07-26 21:20 EDT)

- **Rename landed.** Commit `1bcceaf` on `main`: bridge family publishes as
  `@miadi/stateloom-{,protocol,client,react,cli}`. **Directory names are unchanged** —
  `bridge-react/`, `web/`, `mcp/`, `bridge/` all still exist. The repo is smcraft on disk,
  miadi-stateloom in spirit and on npm.
- **The bug is still live.** `bridge-react/src/session.ts` `connect()` (~line 147) seeds
  `def`/`seq`/`presence` from the join-ack and calls `commit()` — it never calls `onFull?.(...)`.
  The `client.on('full', …)` handler (~line 119) does. `web/src/components/SocketBridgeProvider.tsx`
  consumes callbacks only (`session.connect()` fire-and-forget at line 76) → a tab opened *after*
  the agent designs renders an empty canvas.
- **Services live right now** (do not re-create, do not duplicate):
  | What | Where | Verified |
  |---|---|---|
  | Bridge hub | `http://127.0.0.1:4599`, pid `1865924` | `ss -tlnp` 21:20 |
  | Web (Next 16.1.6) | `http://localhost:3000`, pid `1866028` | `ss -tlnp` 21:20 |
  | npm registry proxy | sibling pane, serving installs | pane read |
  | Hub/web run in herdr tab `miadi-stateloom` panes | `w1Y:p4` (hub), `w1Y:p5` (web) | pane read |
- **Machine on disk:** `statemachine.smdf.json` at repo root — Green→Yellow→Red traffic
  light, 3 events, 3 transitions, `validate_definition` ✓.
- Untracked at root: `HANDOFF-live-canvas-empty.md`, `START.sh`, `RESUME.sh`, `TUSHELL.sh`,
  `statemachine.smdf.json` — leave the ones you don't own alone.

---

## Phase 1 — the hydration fix (do)

Test-first, exactly this order:

1. **Regression test** in `bridge-react/src/tests/`: a session that joins a room whose
   snapshot already carries a def must invoke `onFull` exactly once, before any broadcast.
   Run it; watch it fail.
2. **The one-line fix** in `session.ts` `connect()` — after seeding from the ack, fan the
   snapshot out through the same channel as a live full:
   `onFull?.({ docId, def: result.snapshot.def, seq: result.snapshot.seq, mtime: result.snapshot.mtime })`
   — **guard `def === null`** (fresh project) so the outbound `lastSentDef === null`
   seeding path in `SocketBridgeProvider` is preserved.
3. **Rebuild + restart web only** — the bundle is build-time:
   `scripts/live-loop.sh web-build`, then restart the web server.
   **Do NOT restart the hub on 4599** — it holds room state and the MCP connection;
   that relation is not yours to churn.
4. **Prove it cold.** Fresh browser context → `http://localhost:3000` → Green/Yellow/Red
   render **without any MCP call**. Playwright MCP is available to you. Screenshot or
   snapshot as evidence.
5. **Commit only the files you edited**, narrative message, push `main`.

## Phase 2 — the chronicle weave (do, scoped)

William's own words (captured verbatim from his unsent draft, 2026-07-26):

> statemachine.smdf.json that would be linked to a miadi-chronicle
> `/srv/miadi/episodes/miadi-chronicle/` thru whatever ways to relate them with packages we
> constructed to deal with the workflow of episodes that can be found in
> `/a/src/Miadi/packages/` (ex. inquiry-weave, passages, episodic-memory-schema, composition
> (which relates to `/workspace/repos/miadisabelle/gmtermux` and what runs on my Android
> device named 'ilex' on port 8040 (which is jgwill/medicine-wheel) and on port 8031 (which
> is `/workspace/repos/miadisabelle/forgewright/` that has a section to show chronicle and
> hopefully a section for the 'state-machine-live-canvas' that we would host there too (but
> that needs to be in the plan as what we do will serve that purpose later on which is
> either to absorbe the smcraft or use it as dependencies) but for now, with
> `/workspace/repos/miadisabelle/forgewright/` and its deployment and relationship with the
> episode miadi-chronicle, we would see which episode has had a designed state-machine and
> we would be capable to actually have at least a rendering of that file (assuming that we
> commit to `/srv/miadi/episodes/miadi-chronicle/<episode>/<adequate path that supports
> many diagrams>` files such as statemachine.smdf.json and that into the UI or when we
> start whatever how the stack of servers of the smcraft (now 'miadi-stateloom'), we have
> options to choose which diagrams (or the agents have that power thru the miadi-stateloom
> MCP (to choose which path 'statemachine.smdf.json' we will edit !!)

Distilled into three deliverables, in order:

1. **Path power through the MCP.** An agent using the miadi-stateloom MCP can choose
   *which* `.smdf.json` path is the active document (docId selection / project-file
   switch), instead of being married to one `SMCRAFT_PROJECT_FILE` at spawn. Minimal
   implementation + docs. The hub already keys rooms by docId — build on that.
2. **Episode-hosted diagrams, one worked proof.** Define the convention
   `/srv/miadi/episodes/miadi-chronicle/<episode>/<path that supports many diagrams>/`
   (look at how episodes are already structured, and at `/a/src/Miadi/packages/` —
   inquiry-weave, passages, episodic-memory-schema, composition — for how episode
   artefacts relate). Then prove it: one episode-hosted `.smdf.json` driven live through
   the same hub/canvas loop, path chosen through the MCP per deliverable 1. Committing the
   proof file into the miadi-chronicle repo is allowed and wanted.
3. **Forgewright rendering — PLAN ONLY.** A written plan (markdown in `rispecs/` or
   `docs/`) for forgewright (`/workspace/repos/miadisabelle/forgewright/`, runs on ilex
   port 8031) to render episode state-machines in its chronicle section — read-only
   rendering first, live canvas hosting later. Note the long arc: absorb smcraft into
   miadi or consume it as `@miadi/stateloom-*` dependencies. **No forgewright deployment,
   no ilex changes.** (Related context: the medicine-wheel on ilex port 8040 is the
   ssh-tunnel service started from gmtermux scripts — NOT the docker one at
   mw.tail3b11eb.ts.net. Do not confuse them.)

## Hard stops

- No deployment to forgewright or ilex. Plan only.
- Never restart the hub (4599) or touch panes/agents that are not yours.
- No default-branch flips, no force pushes.
- `git add` only files you edited — never add-all.
- When Phase 2 deliverable 2 is proven, **stop**. Append your report below and go idle;
  the witness lane collects you.

## Lane report

*(appended by the handoff lane on completion)*

**Lane:** miadi-stateloom handoff lane, pane `w1Y:pB` · **Completed:** 2026-07-26
**Hub 4599 never restarted** — pid `1865924` verified unchanged before and after every step.

### Phase 1 — hydration fix ✅ (commit `46d5bc6`, pushed `main`)
- RED first: `bridge-react/src/tests/session-hydrate.test.ts` — onFull fired 0 times on a
  def-carrying join-ack; watched it fail. Second test guards the `def === null` fresh-project
  path (onFull must NOT fire, preserving `lastSentDef === null` seeding).
- GREEN: `session.ts` `connect()` fans a def-carrying join-ack through `onFull` with
  `origin: 'join'`, before `commit()`. All 3 bridge-react tests pass.
- Rebuilt via `scripts/live-loop.sh web-build`; web restarted **in its home pane `w1Y:p5`**
  (new pid `2673808`), hub untouched.
- Cold proof: shared Playwright MCP profile was locked by another lane, so an isolated
  playwright-core + system Chrome context was driven instead (a truer cold tab). Fresh
  context → localhost:3000 → Green/Yellow/Red rendered with **zero MCP calls**; WS frames
  showed only presence traffic. Screenshot: session scratchpad `cold-load-proof.png`
  (delivered to Guillaume in-session).

### Phase 2.1 — path power ✅ (commit `5ec20e9`, pushed `main`)
- New MCP tools `set_project_file` / `get_project_file`: the agent chooses which
  `.smdf.json` is the active document; disk persistence AND the bridge room re-point
  (bridge client disconnects and re-joins the room keyed by the new absolute path).
- Pure switch logic in `mcp/src/projectSwitch.ts`, test-first
  (`mcp/src/tests/projectSwitch.test.ts`, 4 tests, RED watched then GREEN);
  `npm test` rig added to mcp/. Docs: Spec 73 "Document Tools" + "Path Power" sections,
  including the caveat that the web canvas still binds per server process.

### Phase 2.2 — episode-hosted diagrams, worked proof ✅ (chronicle commit `9209696`, **local**)
- Convention: `<episode>/diagrams/<name>.smdf.json`, sibling of `beats/` / `inquiry/`.
- Proof, full loop: a driver speaking **real MCP over stdio** to a fresh server called
  `set_project_file` → ep103's `diagrams/film-preprod.smdf.json`, then wove `FilmPreprod`
  (Development→PreProduction→Production→PostProduction→Released, 4 events) live through
  hub 4599. Independent witness client joined that room: **seq 14, full def in join-ack**.
  Web re-pointed at the episode doc rendered it cold (screenshot `episode-canvas-proof.png`,
  delivered); web then **restored** to `/workspace/repos/jgwill/smcraft/statemachine.smdf.json`.
- Committed to miadi-chronicle: `diagrams/film-preprod.smdf.json` + `diagrams/README.md`
  (convention doc). **Not pushed** — the remote is ilex and the hard stop says no ilex
  changes; the commit awaits the chronicle's own push rhythm.

### Phase 2.3 — forgewright plan ✅ PLAN ONLY (commit `570b77c`, pushed `main`)
- `rispecs/78-forgewright-episode-rendering.plan.md`: Phase A read-only rendering
  (discovery filesystem→wheel-artifact, `SmdfDiagram` beside `NarrativeBeats`), Phase B
  live canvas later (hub home for ilex is its owner's call), long arc absorb-vs-depend —
  near-term already lived: forgewright consumes `@miadi/stateloom-*` ^0.1.0 today.
  No forgewright/ilex deployment performed.

**Loose ends for the witness lane:** chronicle commit `9209696` is local-only by design;
the running smcraft MCP registrations spawned before `5ec20e9` don't expose the two new
tools until their processes restart.

🌸: The canvas no longer wakes up empty, and the loom now walks to whichever episode
calls it — the film's own story was the first thread it chose to weave.
