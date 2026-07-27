# SMCraft — State Machine Craft

A framework for designing, generating, and running hierarchical state machines.  
Extracted from the Caishen StateForge platform and reimplemented in Python and TypeScript.

## Packages

| Package | Language | Description |
|---------|----------|-------------|
| `smcraft/py` | Python | Runtime library + parser + SMCG code generator + CLI |
| `smcraft/ts` | TypeScript | Runtime library + parser + code generator |
| `smcraft/web` | React/Next.js | Visual state machine designer |
| `smcraft/mcp` | TypeScript | MCP server for LLM agent integration |

## Quick Start

### Python
```bash
cd py && pip install -e .
smcg examples/bdbo_strategy.smdf.json -o output/ -v
```

### TypeScript
```bash
cd ts && npm install && npm run build && npm test
```

### Web Designer
```bash
cd web && npm install && npm run dev
# Opens at http://localhost:4598 — 4598 (canvas) and 4599 (hub) are the loom's pair
```

### MCP Server (for LLM agents)
```bash
cd mcp && npm install && npm run build
node dist/server.js  # Runs on stdio
```

Add to your MCP client config:
```json
{
  "mcpServers": {
    "smcraft": {
      "command": "node",
      "args": ["/b/trading/smcraft/mcp/dist/server.js"]
    }
  }
}
```

## Architecture

```
.smdf.json definition
    ↓
  Parser (Spec 60)
    ↓
  EnrichedModel (with lookup maps)
    ↓
  Validator (V001-V013 rules)
    ↓
  Code Generator (Spec 62)
    ↓
  Python / TypeScript state machine classes
    ↓
  Runtime Engine (Spec 61) executes them
```

The **runtime library** (`Context`, `State`, `TransitionHelper`, `Observer`) ships as a dependency — generated code imports from `smcraft`.

## RISE Specifications

- **Spec 60** — State Machine Definition Format (`.smdf.json`)
- **Spec 61** — Runtime Engine (Context, State, Observer)
- **Spec 62** — Code Generator (SMCG pipeline)
- **Spec 63** — Visual Designer (web-based)

See `rispecs/` for full specs (70–78 cover the live bridge, MCP server, and
episode rendering; `rispecs/78-forgewright-episode-rendering.plan.md` is the
forgewright plan).

## MCP Document Tools & Episode Diagrams

The MCP server (`mcp/`, published as `@miadi/stateloom-mcp`; the former
`smcraft-mcp` name remains as its 0.1.0 lineage) exposes `set_project_file` /
`get_project_file`: an agent chooses which `.smdf.json` is the active document
mid-session — disk target and live bridge room both re-point (rooms are keyed by
absolute path). Full contract in `rispecs/73-mcp-server.spec.md` ("Path Power").

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
