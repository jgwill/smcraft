# @miadi/stateloom-client

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-client)](https://www.npmjs.com/package/@miadi/stateloom-client)

Framework-agnostic socket.io-client wrapper for the stateloom real-time design bridge: join, patch, full, presence, and sequence-gap auto-resync.

## Install

```bash
npm install @miadi/stateloom-client
```

## What it is

One thin object that owns the client side of the bridge conversation: connect and join a document room, send and receive patch/full frames, track who else is in the room, and notice when a sequence number skips — which means a frame was missed — and ask the hub for a resync automatically.

It is not the hub (that is `@miadi/stateloom`) and it does not know React (that is `@miadi/stateloom-react`, built on this). It is what the CLI, the MCP server and the React hook all reach for, so all three behave identically on the wire.

## Usage

```ts
import { createBridgeClient } from "@miadi/stateloom-client";
import type { PatchOp } from "@miadi/stateloom-protocol";

const client = createBridgeClient({
  url: "http://127.0.0.1:4599",
  role: "cli",                                   // 'agent' | 'cli' | 'web' | 'runtime'
  docId: "/abs/path/to/statemachine.smdf.json",  // rooms are keyed by absolute path
  name: "guillaume@terminal",
});

const off = client.on("patch", (env) => {
  console.log(`seq ${env.seq}:`, env.ops);
});
client.on("presence", (peers) => console.log(peers.map((p) => p.name)));
client.on("status", (s) => console.log(s));      // connecting | connected | disconnected | error

const { selfId, snapshot, presence } = await client.join();
let def = snapshot.def;

const ops: PatchOp[] = [
  { op: "state.add", parent: "Root", state: { name: "Shipped", kind: "final" } },
];
client.emitPatch(ops, mtimeMs, client.lastSeq);

off();
client.disconnect();
```

### Behaviour worth knowing

- **The hub echoes your own frames back**, so the sender learns its hub-assigned `seq`. The client advances `lastSeq` from that echo but does not re-deliver it to your `patch`/`full` handlers — an optimistic local edit is never applied twice.
- **Auto-resync is on by default.** When an incoming `seq` skips ahead of `lastSeq + 1`, the client calls `request(lastSeq)` before advancing. Pass `autoResync: false` to handle gaps yourself.
- **The hub never writes disk.** Whoever mutates persists through its own durable channel and stamps the resulting `mtimeMs` on the frame it emits; the hub uses that stamp to dedup the writer's own file-watcher echo.
- **Presence is bookkept for you.** `client.presence` is always the current roster; join/leave/update frames are merged before your handler fires.

### API

| Member | Purpose |
|---|---|
| `connect()` | Open the socket (resolves once connected) |
| `join()` | Join the `docId` room; resolves `{ selfId, snapshot, presence }` |
| `emitPatch(ops, mtime?, baseSeq?)` | Send granular ops |
| `emitFull(def, mtime?)` | Send a whole definition |
| `request(sinceSeq?)` | Ask for a resync |
| `updatePresence({ cursor, selection })` | Publish this client's pointer/selection |
| `on(event, handler)` | `patch` \| `full` \| `ack` \| `presence` \| `error` \| `status`; returns an unsubscribe |
| `status` / `lastSeq` / `presence` | Current state, read-only |
| `disconnect()` | Leave the room and close the socket |

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`smcraft`](https://www.npmjs.com/package/smcraft) | State machine engine: parser, validator, interpreter, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — zero runtime deps |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub — **this package** |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines |

## License

MIT © Guillaume Isabelle
