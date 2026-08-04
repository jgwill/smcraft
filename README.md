# SMCraft — State Machine Craft

A framework for designing, generating, and running hierarchical state machines.
Extracted from the Caishen StateForge platform and reimplemented in Python and TypeScript.

One declarative format — SMDF — read by an engine, a code generator, an MCP server,
a terminal CLI, a socket.io hub and a browser canvas. An agent, a person at a shell
and a person at a canvas can all edit the same document while it is open.

## Packages

| Package | Install | Directory | What it is |
|---|---|---|---|
| [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine) | `npm i @miadi/stateloom-engine` | `ts/` | The engine: SMDF parser, validator V001–V014, hierarchical runtime, SMDF interpreter, TypeScript + Python codegen. Renamed from `smcraft`, which is deprecated on npm |
| [`miadi-stateloom-engine`](https://pypi.org/project/miadi-stateloom-engine/) | `pip install miadi-stateloom-engine` | `py/` | The Python twin, plus the `smcg` generator CLI |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | `npm i @miadi/stateloom-protocol` | `bridge-protocol/` | Zero-dependency foundation: patch ops, diff/apply, envelopes, layout, edge routing, ASCII/Mermaid render, export naming |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | `npm i @miadi/stateloom-client` | `bridge-client/` | Framework-agnostic socket.io-client wrapper: join / patch / full / presence with auto-resync |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | `npm i @miadi/stateloom` | `bridge/` | The socket.io hub. Bin `smcraft-bridge` |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | `npm i @miadi/stateloom-react` | `bridge-react/` | React 19 binding: `useSmcraftBridge`, session core, viewport helpers |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `npm i -g @miadi/stateloom-cli` | `cli/` | Bin `smcx` — drive the loom from a terminal |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | `npx -y @miadi/stateloom-mcp` | `mcp/` | The MCP server. Bins `stateloom-mcp` and legacy `smcraft-mcp` |
| [`@miadi/stateloom-skills`](https://www.npmjs.com/package/@miadi/stateloom-skills) | `npx -y @miadi/stateloom-skills` | `skills-cli/` | Bin `stateloom` — installs agent skills into `.claude/skills/` |
| — | run from this repo | `web/` | The visual designer (Next.js). `"private": true`, never published |

Everything depends on `@miadi/stateloom-protocol`. Nothing depends back on it.

## Quick Start

### MCP server (for LLM agents)

No clone, no build:

```json
{
  "mcpServers": {
    "stateloom": {
      "command": "npx",
      "args": ["-y", "@miadi/stateloom-mcp"],
      "env": {
        "STATELOOM_PROJECT_FILE": "/absolute/path/to/machine.smdf.json",
        "STATELOOM_BRIDGE_URL": "http://127.0.0.1:4599"
      }
    }
  }
}
```

`STATELOOM_PROJECT_FILE` must be **absolute** — the MCP server and the web app each
resolve a relative path against their own cwd, and the divergence is silent.
`scripts/live-loop.sh mcp-line` prints the `claude mcp add` line with paths already resolved.

The server speaks **stdio** by default. Setting `STATELOOM_MCP_HTTP_PORT` switches it to
Streamable HTTP at `POST /mcp` (plus `GET /health`) so agents on other machines can reach
the same loom — nothing changes unless you set the port. HTTP mode **requires**
`STATELOOM_MCP_TOKEN` and refuses to start without one, binds `127.0.0.1` unless
`STATELOOM_MCP_HTTP_HOST` says otherwise, and is not multi-tenant: the active document is
process state, so every client shares one board. `STATELOOM_MCP_ROOT` confines that
document to a directory; `STATELOOM_MCP_LOCK_PROJECT=1` refuses `set_project_file` outright.
Full table in [`mcp/README.md`](./mcp/README.md#remote-access-optional-020).

### CLI

```bash
npm i -g @miadi/stateloom-cli
export STATELOOM_PROJECT_FILE=/abs/path/machine.smdf.json

smcx add-state Pending
smcx add-event Start
smcx add-transition Pending Start --to Active
smcx render --as svg
smcx watch                # stream the live doc as ASCII
```

Mutations are durable-first: persist to disk, then emit to the hub. No hub running
is fine — the edit is still a real edit.

### Agent skills

```bash
npx -y @miadi/stateloom-skills skills list
npx -y @miadi/stateloom-skills skills install --all
```

Drops a ready-to-use `SKILL.md` into `.claude/skills/` for each of
`stateloom-setup`, `stateloom-design`, `stateloom-live-loop`, `stateloom-render`,
`stateloom-codegen`, `stateloom-rispec`. Sources live in [`skills/`](./skills/).

### Python engine

```bash
pip install miadi-stateloom-engine
smcg examples/bdbo_strategy.smdf.json -o output/ -v
```

### TypeScript engine

```bash
npm i @miadi/stateloom-engine
```

```typescript
import { Machine } from "@miadi/stateloom-engine/machine";
const machine = new Machine(definition);   // runs the SMDF directly, no codegen
machine.send("Start");
```

### The live loop

```bash
export STATELOOM_PROJECT_FILE=/abs/path/machine.smdf.json
scripts/live-loop.sh hub                                       # hub on 4599
scripts/live-loop.sh web-build && scripts/live-loop.sh web     # canvas on 4598
```

4598 (canvas) and 4599 (hub) are the loom's pair. `scripts/live-loop.sh env` prints
every resolved value and writes `.env.smcraft-live`.

### From source

```bash
cd ts   && npm install && npm run build && npm test
cd web  && npm install && npm run dev
cd py   && pip install -e .
```

## Architecture

```
.smdf.json definition
    ↓
  Parser (Spec 70)
    ↓
  EnrichedModel (with lookup maps)
    ↓
  Validator (V001–V014)
    ↓
  Code Generator (Spec 72)
    ↓
  Python / TypeScript state machine classes
    ↓
  Runtime Engine (Spec 71) executes them
```

The **runtime library** (`Context`, `State`, `TransitionHelper`, `Observer`) ships as a
dependency — generated code imports from `@miadi/stateloom-engine`. `@miadi/stateloom-engine/machine` offers the other
path: interpret the definition in memory and skip generation entirely.

Alongside that, the **live pipeline**: agent, terminal and canvas each emit `PatchOp`s to
the hub, which sequences and broadcasts them. The hub keys rooms by the absolute
project-file path and never writes disk — durability belongs to whoever made the edit.

## RISE Specifications

Full specs in [`rispecs/`](./rispecs/):

| Spec | Covers |
|---|---|
| [70](./rispecs/70-smdf-format.spec.md) | SMDF format — schema, state types, validation V001–V014 |
| [71](./rispecs/71-runtime-engine.spec.md) | Runtime engine — Context, State, TransitionHelper, observers |
| [72](./rispecs/72-code-generator.spec.md) | Code generator — SMCG pipeline, Python + TS targets |
| [73](./rispecs/73-mcp-server.spec.md) | MCP server — tool surface, design session protocol, "Path Power" |
| [74](./rispecs/74-web-designer.spec.md) | Web designer — canvas, store, components |
| [75](./rispecs/75-agent-designer-bridge.spec.md) | Agent ↔ designer bridge — live sync, scaffold pipeline |
| [76](./rispecs/76-rise-rispec-generator.spec.md) | RISE rispec generator — SMDF as exportation terminus |
| [77](./rispecs/77-realtime-design-bridge.spec.md) | Real-time design bridge — granular bidirectional sync |
| [78](./rispecs/78-forgewright-episode-rendering.plan.md) | Forgewright episode rendering (plan) |
| [79](./rispecs/79-layout-persistence.plan.md) | Layout persistence for the live canvas (plan) |

Specs 60-63 in the upstream `caishen` repo define the C# StateForge contracts this
reimplements.

## MCP Document Tools & Episode Diagrams

The MCP server (`mcp/`, published as `@miadi/stateloom-mcp`; the former
`smcraft-mcp` name remains as its 0.1.0 lineage) exposes `set_project_file` /
`get_project_file`: an agent chooses which `.smdf.json` is the active document
mid-session — disk target and live bridge room both re-point (rooms are keyed by
absolute path). Full contract in `rispecs/73-mcp-server.spec.md` ("Path Power").

### Rendering a diagram

Three surfaces draw the same board, so a machine can be looked at from wherever
the work is happening:

```bash
smcx render --as png --scale 2 --open   # → /path/to/statemachine.png
smcx render --as svg                    # needs no rasterizer at all
smcx render --as mermaid --out -        # to stdout, for a README
smcx render --as png --stamp            # → ep252--Film--260730175243.png
```

- **CLI** — `smcx render` reads the durable `.smdf.json` straight off disk (no
  hub, no browser, no agent required) and prints the absolute path it wrote.
  `png` goes through whichever rasterizer the host has — sharp if installed,
  then librsvg, Inkscape, ImageMagick or headless Chrome, tried in that order;
  `svg` needs none.
- **MCP** — `render_diagram` writes the same file and hands the picture back
  inside the tool result, so an agent can see what it just designed. Same
  formats, plus `stamp: true`.
- **Web designer** — the format picker beside 📥 exports as PNG, JPEG, SVG,
  Mermaid (`.mmd`) or Markdown (`.md`, the same graph inside a ```` ```mermaid ````
  fence). The picture formats take the canvas as it stands, hand-dragged boxes
  included; the two text formats come from the definition, since mermaid
  describes a graph and has no placement to carry.

The CLI and MCP derive their layout with the same `autoLayout` behind ⤢ Arrange,
so all three agree on where the boxes sit.

**Export names.** A browser download always, and `--stamp` / `stamp: true` on
demand, produce `[ep252--]<Machine>--<yyMMddHHmmss>.<ext>` — the chronicle
episode when the document lives under one, the machine's own name, and a stamp
to the second so the afternoon's second export never lands on the first. Built
in `bridge-protocol/src/exportName.ts`, so every surface names files alike.

miadi-chronicle episodes host their machines at
`<episode>/diagrams/<name>.smdf.json` (first proven inhabitant: ep103's
`film-preprod`; ep090 predates the convention with six machines under
`state-machines/*.smcraft.json` — see `docs/reviews/` for the reconciliation
recommendation). Handoff history lives in `docs/handoffs/`.

## Definition Format (`.smdf.json`)

```json
{
  "settings": {
    "namespace": "MyApp",
    "name": "OrderWorkflow",
    "asynchronous": false
  },
  "events": [
    {
      "name": "OrderEvents",
      "feeder": "OrderFeeder",
      "events": [
        { "id": "OrderCreated", "parameters": [{ "name": "orderId", "type": "string" }] },
        { "id": "OrderApproved" },
        { "id": "OrderCompleted" }
      ]
    }
  ],
  "state": {
    "name": "Root",
    "states": [
      { "name": "Pending", "transitions": [{ "event": "OrderCreated", "nextState": "Active" }] },
      { "name": "Active", "transitions": [{ "event": "OrderApproved", "nextState": "Completed" }] },
      { "name": "Completed", "kind": "final" }
    ]
  }
}
```

## For agents

[`llms.txt`](./llms.txt) is the index; [`llms-full.txt`](./llms-full.txt) is the deep
reference — tool signatures, the patch vocabulary, runtime semantics, the environment
contract.
