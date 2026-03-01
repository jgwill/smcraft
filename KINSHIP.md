# KINSHIP — SMCraft

## Identity

**SMCraft** (State Machine Craft) is a standalone framework for designing, generating, and running hierarchical state machines. It exists independently of any specific domain — usable for trading workflows, order processing, UI flows, game logic, creative process stages, or any stateful system.

## Origin

Extracted from the **Caishen** legacy C# platform's `StateForge.StateMachine` library and `SMCG` code generator. The RISE framework was used to create specifications (Specs 60-63 in `caishen/rispecs/StateMachineries/`) that guided the Python and TypeScript reimplementation. SMCraft now has its own RISE specs (70-74) in `smcraft/rispecs/`.

## RISE Specifications

| Spec | File | Covers |
|------|------|--------|
| 70 | `rispecs/70-smdf-format.spec.md` | SMDF schema, validation V001-V014, JSON/XML |
| 71 | `rispecs/71-runtime-engine.spec.md` | State, Context, ContextAsync, TransitionHelper, observers |
| 72 | `rispecs/72-code-generator.spec.md` | Python + TS targets, CLI, codegen unification |
| 73 | `rispecs/73-mcp-server.spec.md` | 11 MCP tools, design session protocol |
| 74 | `rispecs/74-web-designer.spec.md` | Components, store, canvas, MMOT drill-down vision |

## Relationships

### Upstream (Feeds From)
- **caishen** — Original C# source for the StateForge runtime patterns and SMCG code generation approach
- **caishen/rispecs/StateMachineries/** — RISE specifications (60-63) that define the framework contracts

### Downstream (Feeds Into)
- **jgt-code** — Terminal trading agent can import `smcraft` for TypeScript state machine runtime
- **jgt-data-server** — Could use state machines for campaign manager coordination (SDS)
- **jgt-strategy-api** — The 13-state FDB Breakout Strategy FSM was designed using smcraft patterns (CREATED → WAITING_BREAKOUT → ... → COMPLETED). The FSM in `src/fsm.py` follows smcraft's hierarchical state architecture.
- **jgtutils** — Previously hosted the Python code; now imports `smcraft` as a dependency
- **mia-code-server** — Creative process stages (Germination → Assimilation → Completion) as hierarchical state machines. smcraft provides the structural engine for mia-code-server's creative lifecycle management. See `mia-code-server/rispecs/smcraft-integration/` for integration specs.
- **Any application** — SMCraft is domain-agnostic; install and use anywhere

### Siblings
- **jgtml** — Both are tooling packages; jgtml for ML pipelines, smcraft for state machines
- **jgtapy** — Both are library packages; jgtapy for indicators, smcraft for state machines

### Conceptual Bridges

#### Structural Tension ↔ State Transitions
The RISE framework's Structural Tension Charts (STC) are, at their core, state machines. A desired outcome defines the target state, current reality is the initial state, and action steps are events that trigger transitions toward resolution. This is not metaphor — it is structural isomorphism:

| STC Concept | State Machine Equivalent |
|-------------|--------------------------|
| Desired Outcome | Target/Final State |
| Current Reality | Initial State |
| Action Step Completion | Transition Event |
| Structural Tension | Distance between current and desired state |
| Resolution | Reaching the final state |

This bridge means smcraft can model RISE planning workflows themselves, creating a recursive self-referencing capability where the framework used to plan work becomes the tool that executes it.

#### Creative Process ↔ State Machine
mia-code-server's creative process (Germination → Assimilation → Completion) maps directly to a composite state machine. Each phase is a composite state containing sub-states (e.g., Germination has TaskDefinition, SpecGeneration, PDEDecomposition). The `creative-process.smdf.json` example demonstrates this mapping.

## Medicine Wheel Alignment

SMCraft operates primarily in **WEST** (validation, structure, reflection) — it provides the architectural scaffolding that state machines need before they can execute. In trading context:
- **EAST**: Designer detects workflow patterns
- **SOUTH**: Parser analyzes and validates definitions
- **WEST**: Code generator transforms to executable form
- **NORTH**: Runtime executes the state machine

## Bundle Role

SMCraft is the **Architect's Toolkit** — it doesn't trade, analyze, or decide. It provides the structural framework that other systems use to organize their state transitions with correctness guarantees. Its growing role is as the structural engine for both trading workflows (jgt-strategy-api FSMs) and creative workflows (mia-code-server lifecycle stages).
