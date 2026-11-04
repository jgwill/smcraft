# Features in PR #12

## Durable Agent Lifecycle

Adds a reusable work-unit state machine spanning creation, planning, execution, human review, approval or rejection, completion or failure, and archival. The starter defines transition intent, payload contracts, and optional event hooks so lifecycle behavior is explicit across design and runtime.

## MCP Lifecycle Bootstrap

Extends `create_state_machine` with an `agent_lifecycle` template option while preserving the blank-machine default. Callers can still explicitly override the asynchronous setting, and the created definition is persisted and broadcast through the active project integration.

## Designer Starter and Specifications

Adds a lifecycle toolbar action and generates SMDF, TypeScript, Python, lifecycle specification, and transition-contract outputs. Replacing a definition resets stale selection and navigation while preserving valid overlapping manual layout positions.

## Runtime Provenance

Adds `ObserverTrace` to both runtime packages. It captures ordered transition and timer events with timestamps and exposes immutable snapshots for downstream persistence, auditing, and replay.

## Consumer CLI Workflows

Adds Python CLI commands to discover and install lifecycle and observer-trace starter assets, plus an issue-report scaffold for reproduction details and environment information. Legacy direct input-file invocation remains supported.

## Cross-Surface Metadata

Preserves lifecycle semantics and event metadata through Python parsing and serialization, exports the new trace and helper APIs, and documents the starter, designer outputs, and consumer workflows for downstream adopters.
