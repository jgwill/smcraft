# MCP Server — Design Session Protocol

> RISE Framework Specification
> References: CAISHEN Spec 63 (State Machine Designer), MCP SDK

**Spec ID**: 73
**Version**: 1.0
**Source**: Extracted from `smcraft/mcp/src/server.ts`
**Implementation**: TypeScript (`mcp/src/server.ts`), Node.js MCP server on stdio

## Creative Intent

**What the MCP Server Enables Users to Create:**
A conversational state machine design workflow where LLM agents create, modify, validate, and generate state machines through structured tool calls — enabling AI-assisted workflow design without manual file editing.

**Desired Outcomes:**
1. Agent creates complete state machine via tool sequence: create → add states → add events → add transitions → validate → generate
2. Validation catches errors mid-design, enabling iterative correction
3. Generated code matches CLI output quality (real codegen, not lightweight reimplementation)
4. Design sessions persist across server restarts

## Tool Inventory

### Creation Tools
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `create_state_machine` | namespace, name | Initialize empty definition with Root state |
| `add_state` | name, parentName?, kind? | Add state to hierarchy (default parent: Root) |
| `add_event` | id, sourceName?, parameters? | Add event to source (default: Internal) |
| `add_transition` | stateName, event, nextState, condition?, action? | Wire transition |

### Modification Tools
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `remove_state` | name | Remove state and all transitions referencing it |

### Query Tools
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `get_definition` | — | Export current definition as JSON |
| `load_definition` | json | Import definition from JSON string |
| `list_states` | — | Tree view with transitions per state |
| `list_events` | — | Flat event list with parameters |

### Action Tools
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `validate_definition` | — | Run validation rules, return errors |
| `generate_code` | language? | Generate executable code (python/typescript) |

## Design Session Protocol

### Session Lifecycle
1. **Initialize**: `create_state_machine` or `load_definition`
2. **Build**: Iterative `add_state`, `add_event`, `add_transition`
3. **Validate**: `validate_definition` → fix errors → re-validate
4. **Generate**: `generate_code` → production-ready output
5. **Export**: `get_definition` → save `.smdf.json` for version control

### In-Memory State
Current implementation holds one definition in server memory. Lost on restart.

## Structural Tensions

### Lightweight Codegen vs Real Codegen
**Current Reality**: `generate_code` tool (server.ts lines 156-251) contains inline Python/TypeScript generators that produce minimal code — missing actions, nested states, entry/exit hooks, timers
**Desired Outcome**: `generate_code` produces the same output as `smcg` CLI — full hierarchy, all features
**Resolution Path**: Replace inline generators with subprocess call to `smcg` CLI:
```typescript
// Instead of inline generatePython()/generateTypeScript():
const tmpFile = writeTempSMDF(definition);
const result = execSync(`smcg ${tmpFile} -l ${language} -o /tmp/output`);
return readGeneratedFile('/tmp/output/');
```

### Session Persistence
**Current Reality**: In-memory only — design lost on server restart
**Desired Outcome**: Sessions auto-save to filesystem, recoverable
**Resolution Path**: Write definition to `.smcraft-session.json` after each mutation, load on startup

### Hierarchical Tool Support
**Current Reality**: Tools operate on flat state list — `add_state` defaults to Root parent
**Desired Outcome**: Tools support full hierarchy — add to specific parent, navigate composite states, manage parallel regions
**Resolution Path**: `add_state` already accepts `parentName` parameter — ensure it works for deep nesting; add tools for parallel region management

## MCP Resources & Prompts

### Resources (Future)
- `smcraft://definition/current` — Live definition JSON
- `smcraft://validation/status` — Current validation state
- `smcraft://generated/{language}` — Last generated code

### Prompts (Future)
- `design-state-machine` — Guided workflow prompt for FSM design
- `review-definition` — Analysis prompt for existing SMDF

## Creative Advancement Scenarios

### Scenario: Agent Designs Trading Strategy FSM
**Desired Outcome**: Trading agent creates complete 13-state FSM via conversation
**Current Reality**: Agent has no structured way to define state machines
**Natural Progression**:
1. `create_state_machine(namespace="trading", name="FDBBreakout")`
2. `add_state(name="WaitingBreakout")`, `add_state(name="WaitingSignal")`, ...
3. `add_event(id="EvBreakoutDetected")`, `add_event(id="EvSignalConfirmed")`, ...
4. `add_transition(stateName="WaitingBreakout", event="EvBreakoutDetected", nextState="WaitingSignal")`
5. `validate_definition()` → fix any errors
6. `generate_code(language="python")` → production FSM code
**Resolution**: Agent delivers complete, validated, generated FSM via structured tool calls

### Scenario: Cross-Platform Integration (mia-code-server)
**Desired Outcome**: mia-code-server creative process stages defined as state machines via MCP bridge
**Current Reality**: mia-code-server has its own rispecs but no state machine integration
**Natural Progression**: mia-code-server MCP proxy → smcraft MCP tools → creative process stages modeled as composite state machine (Germination → Assimilation → Completion)
**Resolution**: Creative process lifecycle is a state machine, designed conversationally

## Dependencies

- **Spec 70 (SMDF)**: The data format tools manipulate
- **Spec 72 (Code Generator)**: `generate_code` should invoke real codegen
- **Spec 74 (Web Designer)**: Web UI and MCP share the same definition model
