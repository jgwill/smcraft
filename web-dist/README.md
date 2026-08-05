# @miadi/stateloom-web

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-web)](https://www.npmjs.com/package/@miadi/stateloom-web)

The stateloom visual state machine designer — a canvas in your browser, joined
live to the bridge hub, so an agent and a person edit the same board at once.

```bash
npx -y @miadi/stateloom-web --doc /abs/path/machine.smdf.json --bridge http://127.0.0.1:4599
# → http://localhost:4598
```

## What it is

A **prebuilt** Next.js app plus a launcher. There is no build step, no
toolchain, and no clone: the package ships the standalone server output and runs
it with plain `node`. Drag states around, draw transitions, edit events, run the
validator, generate code, export the diagram as PNG / JPEG / SVG / Mermaid /
Markdown.

It is not the engine (`@miadi/stateloom-engine` runs machines) and not the hub
(`@miadi/stateloom` sequences the live document). It is the human-facing surface
onto the same `.smdf.json` the agent-facing MCP server writes.

## Install

```bash
# the usual way — no install
npx -y @miadi/stateloom-web

# or keep the command
npm install -g @miadi/stateloom-web
stateloom-web --help
```

## Options

```
stateloom-web [options]

  --doc <path>      the .smdf.json document to open (resolved to absolute)
  --bridge <url>    bridge hub URL, e.g. http://127.0.0.1:4599
  --port <n>        port to serve on (default 4598)
  --host <host>     interface to bind (default 0.0.0.0)
  --version         print versions and exit
```

Flags win over environment. The legacy `SMCRAFT_*` twin of each name is honored.

| environment | default | meaning |
|---|---|---|
| `STATELOOM_PROJECT_FILE` | `./statemachine.smdf.json` | the document |
| `STATELOOM_BRIDGE_URL` | — | the hub; without it edits still save to disk |
| `STATELOOM_WEB_PORT` | `4598` | the port |
| `STATELOOM_WEB_HOST` | `0.0.0.0` | the interface |

**Use an absolute document path.** The designer, the MCP server and the CLI each
resolve a relative path against their own working directory — three processes,
three directories, one silent disagreement. The symptom is a toolbar reading
`○ no disk` while the agent happily writes somewhere else. The launcher resolves
`--doc` to absolute for you.

## The whole loop

4598 (canvas) and 4599 (hub) are the loom's pair.

```bash
export STATELOOM_PROJECT_FILE=/abs/path/machine.smdf.json

npx -y @miadi/stateloom-cli smcx serve --port 4599      # the hub
npx -y @miadi/stateloom-web --bridge http://127.0.0.1:4599   # the canvas
```

Then point an agent at the same document:

```json
{
  "mcpServers": {
    "stateloom": {
      "command": "npx",
      "args": ["-y", "@miadi/stateloom-mcp"],
      "env": {
        "STATELOOM_PROJECT_FILE": "/abs/path/machine.smdf.json",
        "STATELOOM_BRIDGE_URL": "http://127.0.0.1:4599"
      }
    }
  }
}
```

Now the agent's `add_state` appears on the canvas as it is spoken, and a box you
drag shows up in the agent's next `list_states`. Both persist to the same file;
the hub only sequences and broadcasts, it never writes disk.

Without `--bridge` the designer still works — it reads and writes the document
directly over its own file API, and simply has no live peers.

## How the bridge URL reaches the browser

`NEXT_PUBLIC_*` values are inlined at **build** time, which is exactly why this
app could not be published before: a prebuilt bundle would carry the URL of
whoever ran the build, unchangeable. So the client asks the server instead —
`GET /api/config` is evaluated per request, in *your* process, and returns your
`STATELOOM_BRIDGE_URL`. A copy built from source with the env already set still
uses that value on the first render, unchanged.

## Part of the stateloom stack

| package | role |
|---|---|
| [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine) | the engine — parser, validator, runtime, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | patch ops, diff/apply, layout, export names — zero dependencies |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | framework-agnostic socket.io client |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | the socket.io hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React 19 binding — build your own canvas |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — drive it all from the terminal |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | the MCP server LLM agents design through |
| [`@miadi/stateloom-skills`](https://www.npmjs.com/package/@miadi/stateloom-skills) | installable agent skills |
| **`@miadi/stateloom-web`** | **this package — the designer** |

## License

MIT © Guillaume Isabelle
