# MCP Server — Design Session Protocol

> RISE Framework Specification
> References: CAISHEN Spec 63 (State Machine Designer), MCP SDK

**Spec ID**: 73
**Version**: 2.0
**Source**: Extracted from `smcraft/mcp/src/server.ts`
**Implementation**: TypeScript (`mcp/src/server.ts`), Node.js MCP server on stdio
**Revised**: Issue #10 / PR #11 (2026-04-16) — in-memory state replaced by file-backed store; `generate_rispec` added

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
| `generate_rispec` | intent? | Emit RISE framework rispec markdown from current SMDF (see Spec 76) |

### Document Tools (2026-07-26)
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `set_project_file` | path | Choose which `.smdf.json` path is the active document — disk persistence and the live bridge room both re-point |
| `get_project_file` | — | Report active document path, disk presence, bridge status |

## Design Session Protocol

### Session Lifecycle
1. **Initialize**: `create_state_machine` or `load_definition`
2. **Build**: Iterative `add_state`, `add_event`, `add_transition`
3. **Validate**: `validate_definition` → fix errors → re-validate
4. **Generate**: `generate_code` → production-ready output
5. **Export**: `get_definition` → save `.smdf.json` for version control

### File-Backed State (2026-04-16)
Every tool handler reads the current definition from `SMCRAFT_PROJECT_FILE` (absolute path, default `./statemachine.smdf.json`) via `readDef()`, mutates, and writes back via `writeDef()`. There is no in-memory definition; the file *is* the session. The same file is observed by the web designer via `fs.watch` + SSE — see Spec 75.

### Path Power (2026-07-26)
`SMCRAFT_PROJECT_FILE` is only the *initial* document. `set_project_file` re-points the active path mid-session: subsequent reads/writes hit the new file, and the bridge client disconnects and re-joins the hub room keyed by the new absolute path (the hub already serves one room per docId — Spec 77). A missing file is a legitimate switch target: `create_state_machine` or `load_definition` writes it next, and the hub room seeds from disk on first join. This is what lets one agent weave state-machines that live inside miadi-chronicle episodes (e.g. `/srv/miadi/episodes/miadi-chronicle/<episode>/diagrams/*.smdf.json`) without respawning the MCP. Switching resolves relative paths against the MCP process cwd and refuses non-`.json` paths (`mcp/src/projectSwitch.ts`, tested in `mcp/src/tests/projectSwitch.test.ts`).

Caveat: the web canvas binds its docId per server process (`/api/file` resolves the web's own `SMCRAFT_PROJECT_FILE`); pointing the *canvas* at another document currently means restarting the web server with that env — UI-side document choice is future work (see the forgewright rendering plan).

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

### Session Persistence — **resolved**
~~**Current Reality**: In-memory only — design lost on server restart~~
**Desired Outcome**: Sessions auto-save to filesystem, recoverable
**Resolution**: File-backed store (`SMCRAFT_PROJECT_FILE`) — mutations are written synchronously to disk, recovery is `readDef()` on first tool call. The web designer watches the same file via SSE.

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
