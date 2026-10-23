# Opus review circle — 2026-07-26 stateloom day

Three independent Opus reviewers, dispatched by the Tushell guardian lane at
William's request, after the day's work landed (hydration fix `46d5bc6`, MCP
path power `5ec20e9`, forgewright plan `570b77c`, episode proof `9209696` in
miadi-chronicle). All three ran read-only; recommendations only. This file is
the durable record — items below are candidates for the next lanes, not
completed work.

---

## Review 1 — smcraft commits (correctness / tests / docs)

Reviewer ran both suites itself (`bridge-react` 3/3, `mcp` 4/4 pass).

1. **MUST** — `mcp/src/projectSwitch.ts:20-31` + `mcp/src/server.ts:948`: the only
   guard is a `.json` suffix, so an agent can point the loom at `package.json`,
   `tsconfig.json`, or `~/.claude/*.json` and the next `create_state_machine`
   (`server.ts:106` `writeDef`) silently overwrites it. Confine to a root
   (`SMCRAFT_PROJECT_ROOT`, default `dirname(initial PROJECT_FILE)`) and refuse
   an existing `.json` that doesn't parse as SMDF-shaped.
2. **MUST** — `server.ts:951` + `:190,202,215`: `bindBridge`/`joinBridge` are
   async, so the mutating tool that follows a switch hits `status !== "connected"`
   and drops its emit; `droppedEmitWarned` latches once per process, so every
   later drop is silent. Reset the latch in `bindBridge`, and have `bridgeEmit*`
   await a stored join promise before dropping.
3. **MUST** — `projectSwitch.ts:26`: no parent-directory check. Switching to
   `<episode>/diagrams/x.smdf.json` when `diagrams/` is absent reports
   "no file yet — create_state_machine will write it next", then `writeDef`
   throws ENOENT *and* the hub's chokidar watcher (`bridge/src/watcher.ts:47`)
   never fires. Add `parentExists` and either `mkdirSync({recursive:true})` or
   refuse with that reason.
4. **SHOULD** — `bridge-react/src/session.ts:152-170`: join seeding is
   unconditional. A `def:full`/`def:patch` decoded in the same packet batch
   before the `.then` microtask sets a newer `seq`, which the join snapshot then
   rolls back — and that regression is *also* pushed to consumers via `onFull`.
   Seed and fan out only when `result.snapshot.seq >= seq` and nothing has
   landed since `connect()`.
5. **SHOULD** — `session.ts:148-176`: `connect()` is neither idempotent nor
   cancellable. StrictMode double-mount or any explicit `connect()`
   (`useSmcraftBridge.ts:88`) refires `onFull`; a join resolving after
   `disconnect()` still fans out. Add a generation counter bumped by
   connect/disconnect; drop late results.
6. **SHOULD** — `web/src/components/SocketBridgeProvider.tsx:56-64`: hydration
   clobbers local edits — `applyRemote` runs unconditionally, so a user typing
   during the connect window loses it. Branch on `e.origin === 'join'`: when the
   store already holds a definition, prefer `emitFull` (push local) over overwrite.
7. **SHOULD** — `bridge-client/src/client.ts:134`: socket.io reconnect never
   re-emits `JOIN`; after a hub restart the tab sits in no room, status green,
   receiving nothing. Re-join on `'connect'` when a join already happened —
   with item 6's guard, that becomes the recovery path.
8. **SHOULD** — symlink skew: `bridge/src/docio.ts:17`,
   `web/src/lib/projectFile.ts:4`, and `projectSwitch.ts` all use `resolve()`,
   while `scripts/live-loop.sh:20` exports a `realpath -m` path. A symlinked
   episode path lands in a *different* room than the canvas, silently. Use
   `realpathSync.native` when the file exists in all three.
9. **SHOULD** — tests: nothing covers the switch's actual effect (PROJECT_FILE
   mutation → read/write target, `unchanged` skipping rebind, rebinding itself);
   `server.ts` is untestable module-level side effects. Extract `activeDoc.ts`
   (path + bindBridge) and test it. `bridge-react` lacks cases for items 4 and 5.
10. **SHOULD** — docs: `llms.txt:68` tool list and `rispecs/77-*.spec.md:74`
    ("docId = normalized absolute path of `SMCRAFT_PROJECT_FILE`") are stale;
    add both new tools, cross-ref Spec 73 Path Power.
11. **NICE** — `server.ts:154`: the success log prints current `PROJECT_FILE`,
    not the docId joined — two rapid switches make it lie. Pass `docId` into
    `joinBridge(docId)`.
12. **NICE** — `bridge-protocol/src/events.ts:24,42`: `DocSnapshot.def` typed
    non-nullable while `hub.ts:159` sends null (the guard is right, the type is
    wrong); `origin: 'join'` is a synthetic value no hub emits — document
    reserved origins.

Plan 78 judged sound and correctly plan-only; its ilex/hub facts (8031, 8040,
4599) match the repo.

---

## Review 2 — episode/stack weave (chronicle · forgewright · packages)

Verified live: MW healthy at `127.0.0.1:8040` (19 nodes, 100 ceremonies), only
**12 of 143** chronicle dirs registered as `chronicle_episode`, **zero**
`state_machine` nodes. Forgewright already consumes
`@miadi/stateloom-{client,protocol,react} ^0.1.0` and already wires
`state_machine` as a first-class artifact kind
(`src/lib/chronicle/client.ts:4-9`, `ChronicleSnapshot.stateMachines`) — the
chair exists and is empty.

- **MUST — reconcile the two names before writing a glob.** ep090
  (`2026-06-24-episode-090-networking-ceremonies/state-machines/`) holds **six**
  SMDF machines as `*.smcraft.json` + companion `.md` diagrams, byte-shape
  identical to ep103's. A rule matching only `diagrams/*.smdf.json` finds 1 and
  silently misses 6. Match `{diagrams,state-machines}/*.{smdf,smcraft}.json`, or
  migrate ep090 and record the rename. Plan 78's "first inhabitant" line needs
  correcting.
- **MUST — do not fork the read-side.**
  `episodic-memory-schema/src/chronicle-manifest.ts:1-11` exists *"so the app
  and forgewright never fork the read-side"*; the disk enumerator is owned by
  `inquiry-weave/src/catalog.ts`. Add diagram enumeration there; forgewright
  stays a pure MW reader (which is what lets it run from ilex with no chronicle
  working tree).
- **MUST — reuse kind `state_machine`**, not a new `state_machine_diagram`
  (plan 78 §Phase A.1 would fragment an already-wired lane). Node shape follows
  `episode-node.ts`: id `state-machine:<episode>:<name>`,
  `parent_id: chronicle:<episode>`, `relative_path`, plus
  `machine_name`/`namespace` from `settings`.
- **MUST — reorder the scoping.** With 12/143 episodes and 0 machines
  registered, a wheel-fed view renders nothing. Registration is the deliverable;
  the renderer is the easy half.
- **SHOULD — model diagrams on the `stories` precedent**
  (`EpisodeManifestEntry.stories` via `linkStoryForms`,
  `chronicle-manifest.ts:54-57` → add `diagrams?: DiagramManifestEntry[]`).
  Extend the existing `inquiry-weave register` CLI; `registerArtifactRefNode`
  already implements preflight-then-POST, fail-open, 409-as-success.
- **SHOULD — renderer as pure derivation.** `SmdfDiagram` beside
  `NarrativeBeats.tsx`, types from `@miadi/stateloom-protocol` (never re-typed),
  vitest over the derivation, fixture ep103.
- **NICE — name the real Phase B argument.** Spec 73 records the web canvas
  binds docId per server process; forgewright passing `docId` per episode
  *resolves* that limitation. Hub location on ilex stays the gmtermux owner's
  call.
- **NICE — generate `diagrams/README.md`** from the manifest; ep090 and ep103
  both hand-maintain machine tables that will rot.

---

## Review 3 — end-of-day hygiene (executed the same evening)

The steward's checklist was applied by the guardian lane on 2026-07-26:
handoffs moved to `docs/handoffs/`, caches and host-local launchers
gitignored, this README's stale `caishen/` pointer fixed, MCP tools + episode
convention documented in README, chronicle pushed, forgewright's dependency
commit pushed **after** `@miadi/stateloom-*@0.1.0` + `smcraft@0.4.0` +
`smcraft-mcp@0.1.0` were actually published to npmjs (the gate that was
tripped: the deps commit predated the publish). Items deliberately left:
`statemachine.smdf.json` at root (scratch demo), miadi-chronicle's foreign
work-in-progress, `/a/src/Miadi` STC files (other lanes' work).
