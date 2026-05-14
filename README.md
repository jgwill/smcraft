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
# Opens at http://localhost:3000
```

### MCP Server (for LLM agents)
```bash
cd mcp && npm install && npm run build
node dist/server.js  # Runs on stdio
```

The MCP `create_state_machine` tool also supports `template: "agent_lifecycle"` to bootstrap a durable work-unit lifecycle starter.

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
- **Spec 76** — Agent Lifecycle Starter Template

See `caishen/rispecs/StateMachineries/` for full specs.

## Built-in Lifecycle Starter

The repository now includes `examples/agent_lifecycle.smdf.json`, a reusable backbone for durable agent work units:

`Created → Planned → Running → WaitingForHITL → Approved/Rejected → Completed/Failed → Archived`

Use it from:
- the `examples/` folder for CLI/codegen flows
- the web designer via the **🧭 Lifecycle** toolbar action
- the MCP server via `create_state_machine(..., template: "agent_lifecycle")`

The lifecycle starter now makes transition semantics more explicit by including:
- state purposes and transition intent descriptions
- event payload contracts for lifecycle events
- optional event pre/post hooks for specification generation
- stable `ObserverTrace` snapshots for provenance consumers

The web designer can now preview:
- generated TypeScript / Python runtime code
- generated SMDF JSON
- generated lifecycle specification markdown
- generated transition / event contract notes

Both runtimes also export `ObserverTrace`, which records structured transition/timer provenance for audit and replay use cases.

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
