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
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | `npm i @miadi/stateloom-protocol` | `bridge-protocol/` | Zero-dependency foundation: patch ops, diff/apply, envelopes, layout, edge routing, ASCII/Mermaid render, export naming — and the ERD format: types, validator, link check, layout |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | `npm i @miadi/stateloom-client` | `bridge-client/` | Framework-agnostic socket.io-client wrapper: join / patch / full / presence with auto-resync |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | `npm i @miadi/stateloom` | `bridge/` | The socket.io hub. Bin `smcraft-bridge` |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | `npm i @miadi/stateloom-react` | `bridge-react/` | React 19 binding: `useSmcraftBridge`, session core |
| [`@miadi/stateloom-canvas`](https://www.npmjs.com/package/@miadi/stateloom-canvas) | `npm i @miadi/stateloom-canvas` | `bridge-canvas/` | The design surfaces: `<StateMachineCanvas>` and `<EntityRelationshipCanvas>` (crow's foot or Chen) — pan, zoom, drag, routed edges, touch gestures. Props in, callbacks out, CSS-variable themed |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `npm i -g @miadi/stateloom-cli` | `cli/` | Bin `smcx` — drive the loom from a terminal |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | `npx -y @miadi/stateloom-mcp` | `mcp/` | The MCP server: 17 state-machine tools and 10 ERD tools. Bins `stateloom-mcp` and legacy `smcraft-mcp` |
| [`@miadi/stateloom-skills`](https://www.npmjs.com/package/@miadi/stateloom-skills) | `npx -y @miadi/stateloom-skills` | `skills-cli/` | Bin `stateloom` — installs agent skills into `.claude/skills/` |
| [`@miadi/stateloom-web`](https://www.npmjs.com/package/@miadi/stateloom-web) | `npx -y @miadi/stateloom-web` | `web/` → `web-dist/` | The visual designer (Next.js), prebuilt. `web/` stays private; `web-dist/` ships its standalone build |
| [`jgwill/stateloom`](https://hub.docker.com/r/jgwill/stateloom) | `docker run -p 4598:8080 jgwill/stateloom` | `Dockerfile`, `docker/` | The whole loom as one image: hub, canvas, MCP and CLI behind a single port |

Everything depends on `@miadi/stateloom-protocol`. Nothing depends back on it.

## Quick Start

### Docker — the whole loom, one port

```bash
npx -y @miadi/stateloom-skills docker up
```

Writes a compose project, starts hub + canvas + MCP + gateway, waits until every part is
healthy, and prints a URL for your human and an MCP registration for your agent. Pick the
port with `--port`, the documents directory with `--dir`; `--json` gives an agent the whole
answer as data. Or without any Node at all:

```bash
mkdir -p looms
docker run --rm -p 4598:8080 -v "$PWD/looms:/data" --user "$(id -u):$(id -g)" jgwill/stateloom
```

Only one port is published, and the canvas is told its bridge is `/` — **the same origin as
the page** — so the browser's live socket works over localhost, a LAN address, a tailnet
name or a TLS proxy without anything being configured to match. `docs/DOCKER.md` has the
whole design; `stateloom skills install stateloom-docker` hands it to an agent.

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
# or, with nothing checked out:
npx -y @miadi/stateloom-web --bridge http://127.0.0.1:4599
```

4598 (canvas) and 4599 (hub) are the loom's pair. `scripts/live-loop.sh env` prints
every resolved value and writes `.env.smcraft-live`.

### From source

The packages link to each other with `file:` paths, so a package cannot typecheck until the
`dist/` of everything it imports exists. **This order is topological, not alphabetical** —
the same list the release workflow walks:

```bash
for p in ts bridge-protocol bridge-client bridge bridge-react bridge-canvas cli mcp skills-cli; do
  (cd "$p" && npm ci && npm run build) || { echo "FAILED: $p"; break; }
done
cd web && npm ci && npm run dev      # the canvas; needs bridge-canvas built above
cd py  && pip install -e .           # the Python engine and `smcg`
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

## Two diagram types, one loom

A **state machine** (`.smdf.json`) describes one behaviour. An **entity-relationship
diagram** (`.erdf.json`, [Spec 80](./rispecs/80-erdf-format.spec.md)) describes the data
every behaviour acts on, once, for all of them. They are siblings, linked by name only: a
machine's object class names an entity, a guard's `strategy.fractal_count` names an
attribute, and an attribute's `stateOf` names the machine whose state it stores.
`check_links` reports what a machine names that the data does not have — while both are
still drawings.

The same MCP server, hub and designer serve both; the document's type is its extension. An
ERD is drawn in crow's foot or in Chen notation — the viewer's choice, never written to the
file. Both diagram types carry **notes** on the diagram and on each shape (`get_notes`,
`set_notes`), saved in the document for whoever opens it next.

## For agents

[`llms.txt`](./llms.txt) is the index; [`llms-full.txt`](./llms-full.txt) is the deep
reference — tool signatures, the patch vocabulary, runtime semantics, the environment
contract.
