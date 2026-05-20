# Agent Lifecycle Starter Template

> RISE Framework Specification
> References: Spec 71 (Runtime Engine), Spec 73 (MCP Server), Spec 74 (Web Designer)

**Spec ID**: 76
**Version**: 1.0
**Source**: Extracted from `examples/agent_lifecycle.smdf.json`, `mcp/src/server.ts`, `web/src/lib/templates.ts`
**Implementation**: Example SMDF, MCP starter template, web designer starter, runtime provenance observers

## Creative Intent

**What the Agent Lifecycle Template Enables Users to Create:**
A durable execution backbone for agentic work units where planning, runtime execution, HITL review, retry handling, and archival are modeled as one observable state machine instead of scattered ad-hoc process steps.

**Desired Outcomes:**
1. Teams can start from a canonical agent lifecycle instead of rebuilding the same states from scratch
2. MCP-guided design and the visual designer expose the same starter model
3. Runtime observers can record transition provenance for replay, review, and audit trails
4. The starter remains domain-neutral: useful for Navigator, PDE, review queues, or desktop/API automation

## Canonical State Model

The starter template defines the following lifecycle:

`Created → Planned → Running → WaitingForHITL → Approved/Rejected → Completed/Failed → Archived`

The lifecycle is intentionally described as a reusable work-unit contract:

```text
state A
  -> transition event(payload)
    -> optional transition execution / hook
      -> state B
        -> optional entry behavior
```

The current starter makes the following reusable semantics explicit:

- **state definitions**: durable lifecycle phases such as `Created`, `Running`, and `Archived`
- **transition events**: named work-unit signals such as `WorkUnitStarted` or `HitlRejected`
- **transition payload contracts**: event parameters that describe the expected lifecycle payload
- **optional transition hooks**: `preAction` / `postAction` metadata on events plus transition action slots
- **entry / exit behaviors**: state-level `onEntry` / `onExit` hooks supported by SMDF and codegen
- **observable runtime traces**: `ObserverTrace` sequences entry/exit/transition/timer events
- **specification artifacts**: the designer can now emit lifecycle specs and transition contract notes in addition to runtime code

### State Roles
| State | Purpose |
|------|---------|
| `Created` | Work unit exists but has not been planned |
| `Planned` | Inputs, routing, and retry metadata have been prepared |
| `Running` | Runtime adapters are actively executing work |
| `WaitingForHITL` | Execution is paused behind a human review gate |
| `Approved` | Human review passed and execution may resume |
| `Rejected` | Human review failed; work must be retried or archived |
| `Completed` | Execution finished successfully |
| `Failed` | Execution failed and may be retried |
| `Archived` | Provenance has been finalized and the lifecycle is closed |

## Template Surfaces

### Example Definition
- `examples/agent_lifecycle.smdf.json`
- Serves as the canonical reusable SMDF for validation, code generation, and documentation

### MCP Starter
- `create_state_machine(..., template="agent_lifecycle")`
- Allows an LLM agent to bootstrap the lifecycle in one call while preserving the blank default path

### Web Starter
- Toolbar action loads the same lifecycle into the designer
- Gives operators a fast way to explore or modify the backbone visually

### Runtime Provenance
- `ObserverTrace` records ordered lifecycle events with timestamps and sequence numbers
- Intended for audit logs, replay, review queues, and post-run inspection

### Designer Specification Outputs
- The designer now treats the machine as both executable logic and a documentation surface
- Generated artifacts include:
  - Python / TypeScript runtime code
  - SMDF JSON
  - lifecycle specification markdown
  - transition / event contract notes

## Non-Goals

- No domain-specific posting or distribution APIs
- No creator-specific media tooling
- No opinionated job storage backend in the runtime itself
- No forced workflow semantics beyond the starter SMDF

## Structural Tensions

### Durable Storage vs Runtime Recording
**Current Reality**: Runtime observers can see transitions, but there is no built-in structured trace object for later persistence.
**Desired Outcome**: Provenance can be captured as structured data and stored by the host application.
**Resolution Path**: `ObserverTrace` records ordered events that hosts may persist in PostgreSQL, files, or external stores.

### Shared Starter Across Surfaces
**Current Reality**: Blank creation flows exist, but there is no canonical agent lifecycle starter.
**Desired Outcome**: MCP, the visual designer, and examples all begin from the same lifecycle backbone.
**Resolution Path**: Add a built-in agent lifecycle template to each surface while leaving blank-machine flows intact.

### Runtime vs Semantic-Model Consumption
**Current Reality**: Some downstream systems may want to import `smcraft` directly, while others may only need to absorb the lifecycle semantics into their own orchestration engines.
**Desired Outcome**: Both runtime reuse and semantic reuse remain viable.
**Resolution Path**: Keep runtime primitives package-oriented while making transition contracts, payloads, lifecycle intent, and provenance expectations explicit enough to copy or adapt.

## Dependencies

- **Spec 70 (SMDF)**: Defines the starter format
- **Spec 71 (Runtime Engine)**: Emits structured provenance
- **Spec 73 (MCP Server)**: Bootstraps the lifecycle conversationally
- **Spec 74 (Web Designer)**: Makes the lifecycle explorable and editable visually
