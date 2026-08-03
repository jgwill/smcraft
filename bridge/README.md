# @miadi/stateloom

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom)](https://www.npmjs.com/package/@miadi/stateloom)

The socket.io hub of the stateloom real-time design bridge: one in-memory document and sequence per room, presence, an external-edit differ, and mtime/hash dedup.

## Install

```bash
npm install @miadi/stateloom
```

## What it is

A pure sequencer and broadcaster. Clients join a room, send granular patch ops or whole definitions, and the hub assigns the authoritative monotonic `seq`, keeps the current definition in memory, and rebroadcasts to the room. A chokidar watcher notices when the file changes on disk behind everyone's back and turns that into the same patch ops a client would have sent.

**The hub never writes disk.** Each mutating client persists through its own durable channel and stamps the resulting `mtimeMs` on the frame it emits; the hub keeps the last 20 `{mtime, hash}` pairs per room so a writer's own file-watcher echo is recognised and dropped instead of looping.

It is not an HTTP API and not a UI. It serves many documents at once — one room per `docId`, and **a `docId` is a normalized absolute file path**, which is what lets a terminal, a browser tab and an agent that each name the same file end up in the same room.

## Run it

```bash
npx @miadi/stateloom          # via the bin below
smcraft-bridge                # once installed
```

| Environment variable | Default | Meaning |
|---|---|---|
| `STATELOOM_BRIDGE_PORT` | `4599` | Port to bind |
| `STATELOOM_BRIDGE_HOST` | `127.0.0.1` | Interface to bind |
| `STATELOOM_PROJECT_FILE` | — | Default `docId`, and the durable file the watcher follows |
| `STATELOOM_BRIDGE_TOKEN` | — | Optional handshake auth token |

The legacy `SMCRAFT_*` twin of each name is still honored.

## Usage

Embed the hub in a process of your own — a test, a dev server, a desktop shell:

```ts
import { startBridge } from "@miadi/stateloom";

const handle = await startBridge({
  port: 4599,                                   // 0 picks an ephemeral port
  host: "127.0.0.1",
  file: "/abs/path/to/statemachine.smdf.json",  // seeds the default room
  token: process.env.STATELOOM_BRIDGE_TOKEN,
  cors: true,
});

console.log(handle.url);   // "http://127.0.0.1:4599"
console.log(handle.port);

await handle.close();
```

Connect to it with [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client), or from React with [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react).

### Also exported

| Name | Purpose |
|---|---|
| `startBridge(opts)` | Boot the hub; resolves a `BridgeHandle` |
| `normalizeDocId(path)` | The absolute-path normalization rooms are keyed by |
| `readDefFile(path)` | Read and parse a `.smdf.json` from disk |
| `mtimeOf(path)` | Millisecond mtime, or `0` when absent |
| `watchRoom(...)` | The chokidar external-edit differ, standalone |
| `DEDUP_RING_SIZE` | How many `{mtime, hash}` pairs a room retains (20) |
| `Room`, `RingEntry`, `LivePresence`, `StartBridgeOpts`, `BridgeHandle` | Types |

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`smcraft`](https://www.npmjs.com/package/smcraft) | State machine engine: parser, validator, interpreter, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — zero runtime deps |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document — **this package** |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines |

## License

MIT © Guillaume Isabelle
