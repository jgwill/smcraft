# MCP Server — Design Session Protocol

> RISE Framework Specification
> References: CAISHEN Spec 63 (State Machine Designer), MCP SDK

**Spec ID**: 73
**Version**: 3.0
**Source**: Extracted from `mcp/src/server.ts`, `mcp/src/erd.ts`, `mcp/src/projectSwitch.ts`
**Implementation**: TypeScript (`mcp/src/`), published as `@miadi/stateloom-mcp` — bins `stateloom-mcp` and legacy `smcraft-mcp`. Stdio by default, Streamable HTTP optional
**Revised**: Issue #10 / PR #11 (2026-04-16) — in-memory state replaced by file-backed store; `generate_rispec` added
**Revised**: 2026-09-20 (v3.0) — the surface is 17 state-machine tools and 10 ERD tools. Adds `render_diagram`, `set_notes` / `get_notes`, the ERD tool family (Spec 80), the HTTP transport with its three guards, and the resource and prompt that v2.0 listed as future work

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
| `set_project_file` | path | Choose which `.smdf.json` or `.erdf.json` path is the active document — disk persistence and the live bridge room both re-point |
| `get_project_file` | — | Report active document path, disk presence, bridge status |

### Render Tools (2026-07-30)
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `render_diagram` | format?, path?, scale?, theme?, stamp?, open? | Draw the active document next to itself and return the absolute path. `svg`, `png`, `mermaid`, `ascii` for a machine; `mermaid` only for an ERD |

`render_diagram` is the one tool that hands back more than text: for `png` the image itself rides back inside the tool result, so an agent can look at what it just designed. `stamp: true` names each render `[ep252--]<Name>--<yyMMddHHmmss>.<ext>` instead of overwriting one file — the same `exportName` the CLI and the browser use.

### Notes Tools (2026-09-20)
| Tool | Parameters | Purpose |
|------|-----------|---------|
| `get_notes` | — | Read the working notes on the diagram and on every shape that carries one |
| `set_notes` | target?, notes | Write notes on the diagram (`settings.notes`) or on one state / entity (`notes` on the shape) |

Notes work on either document type and are for whoever opens the diagram next — read them before changing a board someone else worked on. Engines, validators and code generation ignore them; they travel in the document because that is the thing that gets shared.

### ERD Tools (2026-09-19, Spec 80)
Ten tools that act on the active document when its extension is `.erdf.json`. Registered from `mcp/src/erd.ts`.

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `create_erd` | namespace, name, description?, path?, overwrite? | Create an ERD and make it the active document |
| `add_entity` | name, description?, weak? | Add an entity; `weak` marks one that exists only through another |
| `update_entity` | name, newName?, description?, weak? | Rename or re-describe an entity, relationships following the rename |
| `add_attribute` | entity, name, type?, key?, references?, nullable?, stateOf? | Add an attribute; `key` is `pk` or `uk`, `stateOf` names the machine whose state it stores |
| `add_relationship` | from, to, cardinality?, label? | Wire two entities — `1:1`, `1:N`, `N:1`, `N:M` |
| `remove_entity` / `remove_attribute` / `remove_relationship` | — | The inverses |
| `validate_erd` | — | Rules E001–E005 |
| `check_links` | erd_path?, smdf_paths? | Rules L001–L004 — what a machine names that the ERD does not carry |

**The loom weaves one active document and its type is its extension.** `get_definition`, `load_definition`, `render_diagram`, `get_notes` and `set_notes` answer for whichever document is active. The state-machine builders refuse to write a machine over an ERD.

## Design Session Protocol

### Session Lifecycle
1. **Initialize**: `create_state_machine` or `load_definition`
2. **Build**: Iterative `add_state`, `add_event`, `add_transition`
3. **Validate**: `validate_definition` → fix errors → re-validate
4. **Generate**: `generate_code` → production-ready output
5. **Export**: `get_definition` → save `.smdf.json` for version control

### File-Backed State (2026-04-16)
Every tool handler reads the current definition from `STATELOOM_PROJECT_FILE` (legacy twin `SMCRAFT_PROJECT_FILE`; absolute path, default `./statemachine.smdf.json`) via `readDef()`, mutates, and writes back via `writeDef()`. There is no in-memory definition; the file *is* the session. The same file is observed by the web designer via `fs.watch` + SSE (Spec 75) and, since Spec 77, by the socket.io hub that carries the same edit as a granular patch.

### Transport (2026-08-12)
Stdio by default — the server runs as a child process beside one agent, and nothing below applies.

Setting `STATELOOM_MCP_HTTP_PORT` serves Streamable HTTP at `POST /mcp` instead, plus a `GET /health` that deliberately says nothing about the active document. Three guards come with that door:

| Guard | Env | Behaviour |
|---|---|---|
| Token | `STATELOOM_MCP_TOKEN` | **Required.** The server refuses to start HTTP mode without one |
| Root | `STATELOOM_MCP_ROOT` | Confines the active document to a directory. A `set_project_file` outside it is refused by name, and a boot whose `STATELOOM_PROJECT_FILE` is already outside it fails |
| Lock | `STATELOOM_MCP_LOCK_PROJECT` | `1` refuses `set_project_file` entirely |

`STATELOOM_MCP_HTTP_HOST` defaults to `127.0.0.1`; `0.0.0.0` is allowed and logs a warning to put TLS in front.

**Not multi-tenant.** The active document is process state, so every client of one HTTP server shares one board. Two agents that must hold different documents need two servers, or the stdio default.

### Env Alias (2026-07-27)
Every `SMCRAFT_*` env read has a `STATELOOM_*` twin: code reads `STATELOOM_*` first and falls back to `SMCRAFT_*` (`envAlias` in `@miadi/stateloom-protocol`, tested in `bridge-protocol/src/tests/env.test.ts`). Existing registrations that bake `SMCRAFT_PROJECT_FILE` / `SMCRAFT_BRIDGE_URL` keep working unchanged.

### Path Power (2026-07-26)
`STATELOOM_PROJECT_FILE` (legacy twin `SMCRAFT_PROJECT_FILE`) is only the *initial* document. `set_project_file` re-points the active path mid-session: subsequent reads/writes hit the new file, and the bridge client disconnects and re-joins the hub room keyed by the new absolute path (the hub already serves one room per docId — Spec 77). A missing file is a legitimate switch target: `create_state_machine` or `load_definition` writes it next, and the hub room seeds from disk on first join. This is what lets one agent weave state-machines that live inside miadi-chronicle episodes (e.g. `/srv/miadi/episodes/miadi-chronicle/<episode>/diagrams/*.smdf.json`) without respawning the MCP. Switching resolves relative paths against the MCP process cwd and refuses non-`.json` paths (`mcp/src/projectSwitch.ts`, tested in `mcp/src/tests/projectSwitch.test.ts`).

~~Caveat: the web canvas binds its docId per server process; pointing the *canvas* at another document means restarting the web server.~~ **Resolved (2026-08-06).** The designer reads `?doc=<absolute path>`, `/api/file` accepts the same parameter against an allowlist, and `set_project_file` hands back the canvas link for the document it just chose. One web server now follows an agent from document to document, and a `.erdf.json` opens the ERD workspace instead of the state-machine one.

## Structural Tensions

### Lightweight Codegen vs Real Codegen — **resolved, with a remainder**
~~**Current Reality**: inline generators that produce minimal code~~
**Resolution**: `generate_code` runs the real `smcg` CLI and returns its output. `generatePythonFallback()` survives for hosts with no Python engine installed.
**Remainder**: the returned text does not say which of the two produced it, so a thin result on a host missing `smcg` reads as a thin machine. See Spec 72.

### Session Persistence — **resolved**
~~**Current Reality**: In-memory only — design lost on server restart~~
**Desired Outcome**: Sessions auto-save to filesystem, recoverable
**Resolution**: File-backed store (`SMCRAFT_PROJECT_FILE`) — mutations are written synchronously to disk, recovery is `readDef()` on first tool call. The web designer watches the same file via SSE.

### Hierarchical Tool Support
**Current Reality**: Tools operate on flat state list — `add_state` defaults to Root parent
**Desired Outcome**: Tools support full hierarchy — add to specific parent, navigate composite states, manage parallel regions
**Resolution Path**: `add_state` already accepts `parentName` parameter — ensure it works for deep nesting; add tools for parallel region management

## MCP Resources & Prompts

### Resources — **implemented**
- `smcraft://definition` — the active document as JSON

### Resources (Future)
- `smcraft://validation/status` — Current validation state
- `smcraft://generated/{language}` — Last generated code

### Prompts — **implemented**
- `design-state-machine(domain?, name?)` — Guided workflow prompt for FSM design

### Prompts (Future)
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
- **Spec 74 (Web Designer)**: Web UI and MCP share the same definition model, and `set_project_file` hands back the link that opens it
- **Spec 77 (Real-Time Design Bridge)**: Every write handler emits a patch to the hub after the disk write — durable first, then live
- **Spec 80 (ERDF Format)**: The ten ERD tools and the rules E001–E005 / L001–L004 they run
