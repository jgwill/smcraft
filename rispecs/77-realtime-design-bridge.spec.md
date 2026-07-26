# Real-Time Design Bridge — Live Granular Bidirectional Sync

> RISE Framework Specification
> References: Spec 73 (MCP Server), Spec 74 (Web Designer), Spec 75 (Agent↔Designer Bridge — file-backed SSE), Spec 76 (RISE rispec generator)
> Consumers: `web/` (Next.js designer), `miadisabelle/forgewright` (runtime platform, `smcraft ^0.3.0`)

**Spec ID**: 77
**Version**: 1.0
**Status**: § design landed; implementation in progress on branch `12-realtime-design-bridge`. Extends Spec 75 without disturbing it.

## Creative Intent

**What This Enables Users to Create:**
A live design surface where a human converses with an LLM agent (over MCP) and the state-machine diagram in the web UI mutates *during* the conversation — node by node, edge by edge — with presence showing who is designing, while a CLI drives the same diagram in real time and a running machine (forgewright) can light up its own live state on the same canvas.

**Desired Outcome:**
The agent, the web UI, the CLI, the running machine, and the file on disk are one design surface. Granular changes animate as they happen. The definition remains the shared artefact; the socket becomes the nervous system that carries each small change the instant it is made.

## Current Reality

1. Spec 75 is live and correct for what it does. MCP and web share `SMCRAFT_PROJECT_FILE`; MCP does `readDef() → mutate → writeDef()` writing the whole file; web hydrates via `GET /api/file` and re-hydrates on `GET /api/watch` SSE (`fs.watch`).
2. Sync is whole-file, not granular. Every remote change re-fetches the entire file and calls `applyRemote()`, replacing the whole `definition`. `Canvas.tsx` repaints with no enter/exit animation.
3. Push is unidirectional and identity-less — SSE carries only `{ mtime }`. No presence, no client→server channel except `PUT /api/file`, no per-change sequence.
4. No CLI can drive the surface.
5. forgewright already wants this — it runs a `Machine` interpreter and hand-rolled a `DesignerSync` + `setupWsBridge` (`src/lib/designer/sync.ts`) with its own `GraphDelta` op set over raw `ws`. That prior art is the seed of a shared protocol it should consume instead of maintain.

The structural tension: the definition is already shared, but change *granularity, direction, identity, and animation* are not. The socket resolves that tension without disturbing the file that anchors it.

## Specification

### 1. Transport decision — socket.io

The CLI and the MCP server are first-class peers, which forces a standalone hub process regardless — a Next.js route handler cannot host a long-lived bidirectional server for non-browser clients. Given the hub is mandatory anyway, socket.io's rooms (one per `docId`), ack callbacks (clean `join → snapshot` handshake), and automatic reconnection remove exactly the machinery a native `ws` design would hand-roll. The one decisive counter-reason ("must run inside the Next route, no extra process") does not hold, because CLI + MCP peers require the extra process. **Commit: socket.io.** The existing SSE bridge stays as the zero-config fallback.

### 2. Architecture

```
   MCP (stdio)                 @miadi/stateloom  (hub)
 ┌──────────────┐        socket.io server · in-memory doc + seq
 │  LLM Agent   │        presence registry · external-edit differ
 │ role:'agent' │        NO disk write — sequencer + broadcaster
 └──────┬───────┘             ▲        ▲        ▲        ▲
        │ writeDef() durable   │socket  │        │        │ chokidar watch
        ▼                      │client  │        │        │ (dedup by mtime)
 ┌──────────────┐  emit def:*  │        │        │        │
 │ SMCRAFT_     │◄─────────────┘        │        │        │
 │ PROJECT_FILE │  stamped w/ mtime     │        │        │
 │ .smdf.json   │──────────────────────────────────────┘
 │ (ONE TRUTH)  │◄── PUT /api/file      │socket  │socket
 └──────┬───────┘                       │        │
        │ fs.watch (Spec 75 SSE)   ┌─────┴───┐ ┌──┴─────────┐  ┌───────────────┐
        ▼                          │ web     │ │ CLI (smcx) │  │ forgewright   │
 ┌─────────────────┐   fallback    │role:web │ │ role:cli   │  │ role:'runtime'│
 │ /api/watch SSE  │──────────────►│Socket|SSE│ └────────────┘  │ enter/exit    │
 └─────────────────┘               └─────────┘                  └───────────────┘
```

**Invariant — the hub never writes disk.** Each mutating client persists through its *existing* channel (MCP via `writeDef()`, web via `PUT /api/file`, CLI via `fs.writeFileSync`) then stamps the resulting `mtimeMs` on the socket event it emits. The hub is a pure sequencer + broadcaster + external-edit differ. Delete the hub and Spec 75 still works unchanged — the bridge is purely additive.

### 3. Package layout

Five new sibling top-level packages (mirroring `ts/`, `mcp/`, `web/`). Boundaries drawn so no consumer pulls a dependency it does not need (MCP/CLI never pull React; the protocol never pulls socket.io).

| Package | Dir | Purpose | Deps |
|---|---|---|---|
| `@miadi/stateloom-protocol` | `bridge-protocol/` | Pure contract: SMDF types, `PatchOp`, `diffDefinition`, `applyPatchOps`, event names, `hashDef`. | none |
| `@miadi/stateloom-client` | `bridge-client/` | Framework-agnostic `createBridgeClient` (socket.io-client). | `socket.io-client`, protocol |
| `@miadi/stateloom` | `bridge/` | socket.io hub: in-memory doc + seq per room, presence, `chokidar` watch → diff broadcast, mtime dedup. `startBridge(opts)` + bin. | `socket.io`, `chokidar`, protocol |
| `@miadi/stateloom-react` | `bridge-react/` | `useSmcraftBridge()` + `SocketBridgeProvider` + `mapOpToAction`. | bridge-client, protocol; peer `react` |
| `@miadi/stateloom-cli` | `cli/` | Design-surface CLI, bin `smcx`. | `commander`, bridge, bridge-client, protocol |

### 4. Event protocol

`docId` = normalized absolute path of `SMCRAFT_PROJECT_FILE`. One socket.io room per `docId`. `seq` is a monotonic integer per doc, assigned by the hub (the sequencer of record). Clients track `lastSeq`; an out-of-order event triggers `def:request` for a full resync.

- **C→S:** `bridge:join` (ack → `{selfId, snapshot, presence}`), `bridge:leave`, `def:patch` (`PatchEnvelope`, no seq), `def:full` (`FullEnvelope`, no seq), `def:request` (`{docId, sinceSeq?}`), `presence:update` (`{cursor?, selection?}`).
- **S→C:** `bridge:welcome`, `def:full` (with seq), `def:patch` (with seq), `def:ack` (`{docId, baseSeq, seq}`), `presence:join|leave|list|update`, `bridge:error`.
- **Roles:** `agent | cli | web | runtime`.

**Reconciliation (one file, one truth):** the hub holds authoritative `{def, seq, ring}` per room, where `ring` is the last N `{mtime, hash}` committed states (`hash` = `hashDef`).
- Inbound event carries `mtime` (origin persisted): hub applies ops, `seq++`, pushes `{mtime, hash}` into `ring`, broadcasts with `seq`. Hub does not write disk.
- File-watch tick: if `{mtime,hash}` ∈ `ring` ⇒ echo of a client's own persist ⇒ ignore (dedup). Else external raw edit (or a standalone MCP writing the same file) ⇒ `ops = diffDefinition(hub.def, fileDef)` ⇒ broadcast `def:patch`; if `fileDef` is unparseable or diff throws ⇒ broadcast `def:full`.
- Concurrent writers: disk remains last-write-wins (inherited from Spec 75, resolving finding #2 of PR #11 at the transport layer with an ordering seq rather than a 3-way merge).

### 5. Diff engine

```ts
diffDefinition(prev: StateMachineDefinition | null, next: StateMachineDefinition): PatchOp[]
applyPatchOps(def: StateMachineDefinition, ops: PatchOp[]): StateMachineDefinition   // pure
```
Round-trip invariant (unit-tested): `applyPatchOps(prev, diffDefinition(prev, next))` deep-equals `next`. The `PatchOp` vocabulary mirrors the MCP tools and the store's granular actions (`settings.update`, `state.add/update/remove/nest`, `eventSource.*`, `event.*`, `parameter.*`, `transition.*`, `action.*`, plus presentational `runtime.enter/exit` that never mutate the SMDF and are never produced by `diffDefinition`). Emit order: `state.add` parents-before-children then `transition.add`; removals reversed. forgewright's `sync.ts::extractStatesAsDeltas` is the prior art this generalizes.

### 6. CLI — `@miadi/stateloom-cli` (bin `smcx`)

Connects via `@miadi/stateloom-client`. Globals: `--bridge <url>` (`$SMCRAFT_BRIDGE_URL`), `--doc <path>` (`$SMCRAFT_PROJECT_FILE`), `--name <label>`.

`serve` (start hub; `--port` `$SMCRAFT_BRIDGE_PORT` default 4599, `--host` default 127.0.0.1) · `add-state <name>` (`--parent --kind --desc`) · `add-event <id>` (`--source --desc`) · `add-transition <state> <event>` (`--to --when`) · `remove-state <name>` · `load <file>` · `watch` (`--as ascii|mermaid`) · `open` (`--web`) · `presence`.

Mutating commands are the same `readDef → mutate → writeDef` pattern as MCP, plus the stamped emit — durable-first, bridge-additive.

### 7. Web integration

A thin `web/src/components/DesignBridge.tsx` picks at runtime: `NEXT_PUBLIC_SMCRAFT_BRIDGE_URL` set → `<SocketBridgeProvider/>`; else the existing `<BridgeProvider/>` (SSE, Spec 75, untouched). `SocketBridgeProvider` joins role `web`, applies `def:full` via `applyRemote` and `def:patch` via a new batched `applyRemoteOps(ops, mtime, seq)` that maps each op to the *existing* granular store action under an `_applyingRemote` guard (no re-emit, no undo flooding). Local edits emit `diffDefinition(prev, next)` stamped with the PUT-response mtime.

**Store additions (additive only):** `activeStates: Set<string>`, `enterState/exitState` (runtime highlight), `presence: Presence[]` + `setPresence`, `_applyingRemote` guard, `applyRemoteOps`.

**Canvas animation (CSS/SVG, no deps):** stable `key={state.name}`; `sm-node-enter` keyframe (opacity+scale in, ~220ms, `transform-box: fill-box`); exit via a local `exitingStates` map rendered with `sm-node-exit` dropped on `animationend`; edges animate `stroke-dashoffset` via `pathLength=1`; `runtime.enter` → `sm-node-active` pulse (this is what forgewright lights up).

### 8. MCP integration

Gated by `SMCRAFT_BRIDGE_URL`; standalone (Spec 75) unchanged when unset. On `main()`, connect a bridge client (role `agent`, best-effort; failure logs and yields a no-op). A `commit(prev, next, full?)` helper wraps `writeDef(next)` then stamps `statSync(PROJECT_FILE).mtimeMs` and emits `def:patch`/`def:full`. Insertion points: the six mutating handlers (`create_state_machine` full, `add_state`/`add_event`/`add_transition`/`remove_state` granular, `load_definition` full). Non-mutating handlers untouched.

### 9. forgewright reuse

forgewright imports `@miadi/stateloom-react`, retires its bespoke `setupWsBridge`/raw-`ws` path. `useSmcraftBridge({ url, docId, role:'runtime', onFull?, onPatch?, onPresence? })` returns `{ status, def, seq, presence, activeStates, emitPatch, emitFull, enter, exit, connect, disconnect }`. On each `fireEvent` success forgewright calls `enter(currentState, previousState, eventId)`; every subscriber pulses the live leaf via `activeStates` — runtime state animates on a design-time canvas without mutating the SMDF.

## Structural Tension Chart

| # | Current Reality | Desired Outcome | Resolution |
|---|---|---|---|
| 1 | Whole-file re-fetch repaints the diagram | One added state animates one node in | `diffDefinition` + granular `def:patch` + Canvas keyframes |
| 2 | Push is unidirectional | Bidirectional granular flow, all peers equal | socket.io hub + `def:patch`/`def:full` both ways |
| 3 | No identity on the surface | Presence shows who is designing | `presence:*` + `Presence` registry |
| 4 | No CLI can drive the diagram | `smcx` emits into the live surface | `@miadi/stateloom-cli` over `@miadi/stateloom-client` |
| 5 | Running machines cannot show live state | forgewright lights up its live leaf | `runtime.enter/exit` + `activeStates` + `useSmcraftBridge` |
| 6 | forgewright hand-rolls its own ws sync | forgewright consumes one shared protocol | `@miadi/stateloom-protocol` + `@miadi/stateloom-react` |
| 7 | External file edits arrive as opaque swaps | External edits animate granularly | Hub file-watch → `diffDefinition` → `def:patch` |
| 8 | A client's own write echoes back | Self-writes are ignored | mtime+hash ring dedup at the hub |
| 9 | Spec 75 must keep working with the bridge off | File + SSE unaffected; bridge additive | Hub never writes disk; env-gated everywhere |

## Build sequence (dependency-aware; parallel workstreams touch disjoint directories)

- **Serial foundation — WS1:** `bridge-protocol/` (types, ops, diff, apply, events, seq + round-trip tests). Blocks all.
- **Wave A (∥):** WS2 `bridge-client/` · WS3 `bridge/` (hub + watcher + dedup + integration tests).
- **Wave B (∥):** WS4 `cli/` · WS5 `bridge-react/` · WS6 `mcp/` (`mcp/src/server.ts`).
- **Wave C (∥):** WS7a `web/` provider + store (`DesignBridge.tsx`, `SocketBridgeProvider.tsx`, `useDesignerStore.ts`) · WS7b `web/` canvas (`Canvas.tsx`, `globals.css`) · WS8 `miadisabelle/forgewright` (separate repo).
- **Wave D:** WS9 e2e (`web/tests/e2e/bridge.spec.ts`, Playwright).

## Test strategy

- **Unit** — diff engine round-trip + fixture assertions (`bridge-protocol/tests/`).
- **Integration** — hub on an ephemeral port; two clients; assert patch propagation with `seq`, presence lifecycle, external-write diff broadcast, and mtime-dedup suppression (`bridge/tests/`).
- **e2e** — boot hub + web with `NEXT_PUBLIC_SMCRAFT_BRIDGE_URL`; run `smcx add-state Foo`; assert the canvas shows `Foo` with `sm-node-enter` and presence lists role `cli`; emit `runtime.enter Foo` → assert `sm-node-active` pulse.

## Implementation Status

1. ✅ `@miadi/stateloom-protocol` (19 tests) 2. ✅ `@miadi/stateloom-client` (1) 3. ✅ `@miadi/stateloom` hub (5) 4. ✅ `@miadi/stateloom-react` (1) 5. ✅ `@miadi/stateloom-cli` `smcx` (4) 6. ✅ MCP bridge client (env-gated, smoke-verified) 7. ✅ Web provider + store + Canvas animation (build + lint clean) 8. ✅ forgewright reuse (408 tests still green) 9. ✅ Full-loop integration proven (CLI → hub → web-role client receives live granular patches; hub binary boots + serves socket.io)

## Running it live

```bash
# 1. build the packages (once), in dependency order
for p in bridge-protocol bridge-client bridge bridge-react cli; do (cd $p && npm install && npm run build); done

# 2. start the hub against a project file
SMCRAFT_PROJECT_FILE=./demo.smdf.json SMCRAFT_BRIDGE_PORT=4599 node bridge/dist/bin.js

# 3. start the web designer pointed at the hub (NEXT_PUBLIC_* is read at dev/build time)
cd web && SMCRAFT_PROJECT_FILE=../demo.smdf.json NEXT_PUBLIC_SMCRAFT_BRIDGE_URL=http://127.0.0.1:4599 npm run dev

# 4. drive the live canvas from the terminal (or point an MCP agent at the same file + SMCRAFT_BRIDGE_URL)
node cli/dist/index.js --bridge http://127.0.0.1:4599 --doc ./demo.smdf.json add-state Green
node cli/dist/index.js --bridge http://127.0.0.1:4599 --doc ./demo.smdf.json watch --as mermaid
```
The node blooms onto the browser canvas the instant the CLI (or agent) emits it; `smcx watch` mirrors the same live machine as mermaid/ascii in the terminal.

## Dependencies

- **Spec 75** — the file + SSE substrate this extends and the fallback path.
- **Spec 73** — the mutation vocabulary the `PatchOp` union mirrors; the six write handlers that gain a `commit` emit.
- **Spec 74** — the zustand store's granular actions the op→action map targets; the Canvas the animation contract extends.
- **Spec 70 (SMDF)** — the document type carried in every envelope.
- **`smcraft ^0.3.0` runtime** — the `Machine` interpreter forgewright drives to produce `runtime.enter/exit`.
- **socket.io / socket.io-client / chokidar / commander** — new runtime deps, isolated to the packages that need them.

**Env vars:** `SMCRAFT_BRIDGE_URL`, `SMCRAFT_BRIDGE_PORT` (4599), `SMCRAFT_BRIDGE_HOST` (127.0.0.1), `NEXT_PUBLIC_SMCRAFT_BRIDGE_URL`, `SMCRAFT_BRIDGE_TOKEN` (optional), `SMCRAFT_PROJECT_FILE` (unchanged; durable truth + `docId` source).
