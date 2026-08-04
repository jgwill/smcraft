# @miadi/stateloom-mcp

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-mcp)](https://www.npmjs.com/package/@miadi/stateloom-mcp)

MCP server for stateloom — an LLM agent designs a hierarchical state machine through conversation, and the diagram on your screen changes while it talks.

## Install

```bash
npm install -g @miadi/stateloom-mcp
# or let your MCP client fetch it:
npx -y @miadi/stateloom-mcp
```

## What it is

A [Model Context Protocol](https://modelcontextprotocol.io) server over stdio that gives an agent fifteen tools for building a state machine: create it, add states and events and transitions, validate it, generate code or a RISE rispec from it, and draw it. Every mutation persists to a `.smdf.json` file on disk and — when a bridge URL is configured — emits to the live hub, so a human watching the web canvas or a terminal running `smcx watch` sees each edit as the agent makes it.

It is not the state machine engine (`@miadi/stateloom-engine` runs the machines) and not the hub (`@miadi/stateloom` sequences the live document). This is the agent-facing surface, sitting beside the human-facing ones on the same file.

## Configure your MCP client

```json
{
  "mcpServers": {
    "stateloom": {
      "command": "npx",
      "args": ["-y", "@miadi/stateloom-mcp"],
      "env": {
        "STATELOOM_PROJECT_FILE": "/abs/path/to/statemachine.smdf.json",
        "STATELOOM_BRIDGE_URL": "http://127.0.0.1:4599"
      }
    }
  }
}
```

| Environment variable | Default | Meaning |
|---|---|---|
| `STATELOOM_PROJECT_FILE` | `./statemachine.smdf.json` | The document read and written; also the live room key |
| `STATELOOM_BRIDGE_URL` | — | Hub URL; without it the server persists to disk only |
| `STATELOOM_AGENT_NAME` | — | Presence label shown to other people in the room |
| `STATELOOM_BRIDGE_TOKEN` | — | Handshake token, when the hub requires one |

The legacy `SMCRAFT_*` twin of each name is still honored. The package ships two bins — `stateloom-mcp` and, for existing registrations, `smcraft-mcp`.

## Remote access (optional, 0.2.0+)

By default this server speaks **stdio** and runs as a child process beside one agent,
with that agent's trust. Setting a port switches it to Streamable HTTP so agents on
other machines can reach the same loom. Nothing changes unless you set the port.

```bash
STATELOOM_MCP_HTTP_PORT=4790 \
STATELOOM_MCP_TOKEN="$(openssl rand -hex 32)" \
STATELOOM_MCP_ROOT=/srv/machines \
  npx -y @miadi/stateloom-mcp
# → stateloom-mcp on http://127.0.0.1:4790/mcp
```

| Environment variable | Default | Meaning |
|---|---|---|
| `STATELOOM_MCP_HTTP_PORT` | — | Bind this port and speak HTTP. **Unset means stdio**, unchanged. |
| `STATELOOM_MCP_HTTP_HOST` | `127.0.0.1` | Interface. Loopback by default — put a TLS terminator in front before widening it. |
| `STATELOOM_MCP_TOKEN` | — | **Required in HTTP mode.** `Authorization: Bearer <token>`, compared in constant time. |
| `STATELOOM_MCP_ROOT` | — | Confine the active document to this directory; `set_project_file` refuses to leave it. |
| `STATELOOM_MCP_LOCK_PROJECT` | — | `1`/`true` refuses `set_project_file` outright. |

Endpoints: `POST /mcp` (the MCP endpoint) and `GET /health`.

The server **refuses to start** in HTTP mode without a token. A reachable port here is a
way to read and write files on the host, and a default-open one would be a mistake someone
else pays for.

### What remote mode is not

**It is not multi-tenant.** The active document is process state, so every HTTP client
shares one board. That is the loom's whole premise when a human and an agent work together,
and a hazard between strangers — one caller's `set_project_file` moves the document for
everyone. `STATELOOM_MCP_ROOT` bounds where it can move; `STATELOOM_MCP_LOCK_PROJECT` stops
it moving at all. Run one server per document, or per team, rather than one for everybody.

Each request gets its own server instance and transport (stateless Streamable HTTP), so
clients may connect, disconnect and reconnect freely.

**It does not serve concurrent clients fairly.** `generate_code` shells out to `smcg` and
`render_diagram` shells out to a rasterizer, both synchronously — they block the event loop
for as long as the subprocess runs. On stdio that is invisible, because there is one caller
and it is waiting anyway. Over HTTP, one agent's slow codegen stalls every other request,
and a subprocess outlasting Node's 5-second keep-alive timeout makes those requests fail
outright rather than merely arrive late. Until those calls are made asynchronous, treat a
remote server as serving one working agent at a time, not a pool.

**What is confined and what is not.** With `STATELOOM_MCP_ROOT` set, both caller-supplied
paths — `set_project_file`'s `path` and `render_diagram`'s `path` — are resolved through
`realpath` and refused if they land outside the root, so a symlink inside the root cannot
walk out of it. The server also refuses to start if `STATELOOM_PROJECT_FILE` is itself
outside the root. `generate_code` writes only to a temporary directory. Note that
`STATELOOM_MCP_ROOT` is read the same way every other setting is, so it constrains
`set_project_file` on stdio too if you set it there.

## Tools

| Tool | What it does |
|---|---|
| `create_state_machine` | Start a definition with a namespace and name |
| `add_state` | Add a state; parent defaults to `Root` |
| `add_event` | Add an event to an event source |
| `add_transition` | Add a transition from a state, triggered by an event |
| `remove_state` | Remove a state |
| `get_definition` | Return the whole definition as JSON |
| `load_definition` | Replace the definition from JSON |
| `list_states` | Every state with its kind and transitions |
| `list_events` | Every event |
| `validate_definition` | Run the rule-coded validator |
| `generate_code` | Emit Python or TypeScript from the definition |
| `generate_rispec` | Emit a RISE rispec in markdown, folding in the source PDE's intent when the SMDF carries one |
| `render_diagram` | Draw the machine as `png`, `svg`, `mermaid` or `ascii`, write it beside the document, and hand a `png` back inside the tool result so the agent sees what it designed |
| `set_project_file` | Re-point the loom at another `.smdf.json` mid-session — disk target and live room both move |
| `get_project_file` | The active document path, whether it exists, and bridge status |

Also exposed: the resource `smcraft://definition` (the current definition), and the prompt `design-state-machine` — a guided conversation for building one from a domain description.

## What a session looks like

> **You:** design an order fulfillment workflow
>
> The agent calls `create_state_machine`, then `add_event` and `add_state` and `add_transition` a few times, then `validate_definition` to check its work, then `render_diagram` to look at it. Every one of those writes `/abs/path/to/statemachine.smdf.json` and pushes the change to the hub. Your canvas redraws as it goes.

Because rooms are keyed by the document's absolute path, `set_project_file` is how one agent moves between machines in a session — point it at another episode's diagram and the next edit lands there instead.

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine) | State machine engine: parser, validator, interpreter, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — zero runtime deps |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines — **this package** |

## License

MIT © Guillaume Isabelle
