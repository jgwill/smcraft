# KINSHIP — SMCraft

## Identity

**SMCraft** (State Machine Craft) is a standalone framework for designing, generating, and running hierarchical state machines. It exists independently of any specific domain — usable for trading workflows, order processing, UI flows, game logic, or any stateful system.

## Origin

Extracted from the **Caishen** legacy C# platform's `StateForge.StateMachine` library and `SMCG` code generator. The RISE framework was used to create specifications (Specs 60-63) that guided the Python and TypeScript reimplementation.

## Relationships

### Upstream (Feeds From)
- **caishen** — Original C# source for the StateForge runtime patterns and SMCG code generation approach
- **caishen/rispecs/StateMachineries/** — RISE specifications that define the framework contracts

### Downstream (Feeds Into)
- **jgt-code** — Terminal trading agent can import `smcraft` for TypeScript state machine runtime
- **jgt-data-server** — Could use state machines for campaign manager coordination (SDS)
- **jgtutils** — Previously hosted the Python code; now imports `smcraft` as a dependency
- **Any application** — SMCraft is domain-agnostic; install and use anywhere

### Siblings
- **jgtml** — Both are tooling packages; jgtml for ML pipelines, smcraft for state machines
- **jgtapy** — Both are library packages; jgtapy for indicators, smcraft for state machines

## Medicine Wheel Alignment

SMCraft operates primarily in **WEST** (validation, structure, reflection) — it provides the architectural scaffolding that state machines need before they can execute. In trading context:
- **EAST**: Designer detects workflow patterns
- **SOUTH**: Parser analyzes and validates definitions
- **WEST**: Code generator transforms to executable form
- **NORTH**: Runtime executes the state machine

## Bundle Role

SMCraft is the **Architect's Toolkit** — it doesn't trade, analyze, or decide. It provides the structural framework that other systems use to organize their state transitions with correctness guarantees.
