# Handoff — live canvas renders empty on page load

**Diagnosed:** 2026-07-26 ~19:55 EDT, session `smcraft-260726` (remote-control demo agent)
**Status:** root cause located, **no fix applied** — handing off by request.

---

## Symptom

Open `http://localhost:3000/` → diagram is empty, even though the agent designed a
3-state traffic light over MCP and the file on disk is correct.

## Verdict

**The server-side chain is 100% healthy. The defect is one missing callback in the
browser client: the join-ack snapshot is seeded into session-internal state that the
designer store never reads.**

The canvas only ever renders what arrives *after* the tab is open. A tab opened
*before* the agent edits animates correctly; a tab opened *after* shows nothing.

---

## Evidence — everything that is NOT broken

| Layer | Check | Result |
|---|---|---|
| Disk | `statemachine.smdf.json` | ✅ Green/Yellow/Red + 3 events + 3 transitions, mtime 18:13:46 |
| MCP proc | pid 1737266 env | ✅ `SMCRAFT_PROJECT_FILE` + `SMCRAFT_BRIDGE_URL=http://127.0.0.1:4599` |
| MCP config | `_SMCRAFT_MCP_CONFIG` | `/workspace/repos/jgwill/smcraft` (historical `/b/trading` pointer removed — `/b/trading` consumes stateloom, do not work there) |
| Bridge hub | pid 1865924, `bridge/dist/bin.js --port 4599` | ✅ socket.io handshake returns sid |
| Sockets | `ss -tnp` | ✅ MCP ↔ hub ESTABLISHED; Chrome ↔ hub ESTABLISHED (2 tabs) |
| Hub room state | join-ack probe | ✅ `docId` correct, `seq=2`, `def` present, `STATES=["Green","Yellow","Red"]` |
| Web server | pid 1866028 env | ✅ absolute `SMCRAFT_PROJECT_FILE` (no cwd divergence) |
| Web API | `GET /api/file` | ✅ 200, serves full traffic-light JSON from correct path |
| Build freshness | sources vs `.next/BUILD_ID` | ✅ no source newer than build — build is current |

Note: an early probe of mine reported "no snapshot received" — that was **my probe's
fault**, not a bug. The hub delivers the snapshot only through the `bridge:join` **ack
callback**, never as a broadcast. Re-probed with an ack and the def was there.

---

## Root cause

Two files, one dropped handoff.

### 1. `bridge-react/src/session.ts` — `connect()` (~line 148)

```ts
function connect(): void {
  // join() connects first, then seeds def/presence/seq from the ack snapshot.
  void client.join().then((result: JoinResult) => {
    def = result.snapshot.def;
    seq = result.snapshot.seq;
    presence = result.presence;
    commit();              // ← seeds INTERNAL state only
                           // ← onFull?.(...) is NEVER called here
  })
```

Compare the live-broadcast path in the same file (~line 119), which *does* fan out:

```ts
client.on('full', (e: FullEnvelope) => {
  def = e.def;
  onFull?.(e);            // ← consumers get hydrated
  commit();
});
```

### 2. `web/src/components/SocketBridgeProvider.tsx` (~line 51)

Consumes **only** the callbacks — `onFull` / `onPatch` / `onPresence` — each writing
into `useDesignerStore`. It calls `session.connect()` fire-and-forget and never reads
`session.getSnapshot()`.

**Net effect:** join-ack def lands in session-internal `def`; the Zustand designer store
that `Canvas.tsx` renders from stays empty → blank canvas until a live `def:full` /
`def:patch` broadcast arrives.

`useSmcraftBridge.ts` subscribes to the session snapshot, so the hook-based consumer is
likely unaffected — this bug is specific to the callback-only consumer.

---

## Fix options (not applied)

**Preferred — one line, fixes every consumer.** In `session.ts` `connect()`, after
seeding, fan the join snapshot out through the same channel as a live full:

```ts
onFull?.({ docId, def: result.snapshot.def, seq: result.snapshot.seq, mtime: result.snapshot.mtime });
```

Guard for `def === null` (fresh project / hub with no def) so the outbound
`lastSentDef === null` seeding path in `SocketBridgeProvider` is preserved.

**Alternative — local.** In `SocketBridgeProvider`, after `session.connect()`, read
`session.getSnapshot().def` and push through `useDesignerStore.applyRemote(...)`.
Fixes only this consumer; leaves the trap for the next one.

**Rebuild is mandatory either way** — the web bundle is build-time:
```
scripts/live-loop.sh web-build && scripts/live-loop.sh web
```
(`NEXT_PUBLIC_*` is inlined at build; a running server cannot flip it.)

**Add a regression test** in `bridge-react/src/tests/session.test.ts`: a session that
joins a room with an existing def must invoke `onFull` exactly once before any broadcast.

---

## Running environment (for the next session)

| What | Value |
|---|---|
| Canvas | http://localhost:3000 (next-server pid 1866028, cwd `web/`, started 18:12:34) |
| Bridge hub | http://127.0.0.1:4599 (pid 1865924, started 18:12:33) |
| MCP server | pid 1737266, started **17:49:36** — *before* the hub; socket.io auto-reconnect recovered it |
| MCP config | `/workspace/repos/jgwill/smcraft` (`/b/trading` pointer removed — it consumes stateloom, do not work there) |
| Env file | `.env.smcraft-live` (generated by `scripts/live-loop.sh`) |
| Project file | `/workspace/repos/jgwill/smcraft/statemachine.smdf.json` |

Both bound to `127.0.0.1` — same host, no tunnel needed.

## To watch a live design session work *today*, unpatched

Open the tab **first**, then have the agent make MCP calls. Patches broadcast to already
-connected clients work correctly — it is only the cold-load hydration that is lost.

## Machine currently on disk

```
Root
  Green  --[GREEN_TIMER_EXPIRED]-->  Yellow
  Yellow --[YELLOW_TIMER_EXPIRED]--> Red
  Red    --[RED_TIMER_EXPIRED]-->    Green
```
`validate_definition` → ✓ valid.
