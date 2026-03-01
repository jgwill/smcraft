# Code Generator (SMCG)

> RISE Framework Specification
> References: CAISHEN Spec 62 (State Machine Code Generator)

**Spec ID**: 72
**Version**: 1.0
**Source**: Extracted from `smcraft/py/smcraft/codegen.py`, `smcraft/ts/src/codegen.ts`, `smcraft/py/smcraft/cli.py`
**Implementation**: Python (`py/smcraft/codegen.py`), TypeScript (`ts/src/codegen.ts`), CLI (`smcg`)

## Creative Intent

**What the Code Generator Enables Users to Create:**
Production-ready executable code from SMDF definitions — complete state classes, context managers, event dispatchers, and timer hooks — in Python or TypeScript, via CLI or programmatic API.

**Desired Outcomes:**
1. `smcg input.smdf.json -o output/` produces immediately runnable `{name}_fsm.py`
2. Generated code preserves full hierarchy (entry/exit chains, guard conditions, action hooks)
3. TypeScript target produces equivalent output for Node.js/browser environments
4. MCP tool invokes the same codegen — no separate reimplementation

## Core Concepts

### Generation Pipeline
```
SMDF File → Parser → EnrichedModel → CodeGenerator → Output File
                         ↓
                   Validation (V001-V014)
```

### EnrichedModel
Parser output enriched with lookup maps:

| Map | Purpose |
|-----|---------|
| `state_map` | name → StateDef (all states in tree) |
| `event_map` | event_id → EventDef |
| `timer_map` | timer_name → TimerDef |
| `event_source_map` | name → EventSourceDef |
| `leaf_states` | List of leaf state names |
| `composite_states` | List of composite state names |

### PythonCodeGenerator
Transforms EnrichedModel into a single Python file containing:

1. **State Enum** (`IntEnum`)
   ```python
   class States(IntEnum):
       ROOT = 0
       IDLE = 1
       RUNNING = 2
   ```

2. **Base State Class** — Virtual event handlers
   ```python
   class StateBase(State):
       def on_ev_start(self, context, param1): pass
   ```

3. **Leaf State Classes** — One per leaf state with concrete handlers
   ```python
   class StateIdle(StateBase):
       def on_entry(self, context):
           # generated entry actions
       def on_ev_start(self, context, param1):
           if condition:
               context.transition_to(States.RUNNING, lambda: action())
   ```

4. **Context Class** — State lifecycle manager
   ```python
   class MyMachineContext(Context):  # or ContextAsync if asynchronous
       def __init__(self):
           # state instantiation, timer setup, initial state
   ```

5. **Feeder Classes** — Typed event dispatch per source
   ```python
   class UserActionsFeeder:
       def on_ev_start(self, context, param1):
           context._current_state.on_ev_start(context, param1)
   ```

### TypeScript CodeGenerator
Mirrors Python output structure adapted for TypeScript:
- `enum States { ... }`
- `class StateBase extends State { ... }`
- `class MyMachineContext extends Context { ... }`

### CLI Interface (`smcg`)

```bash
smcg <input.smdf.json> [options]

Options:
  -o, --output <dir>     Output directory (default: cwd)
  -l, --language <lang>  Target language: python (default)
  -n, --name <name>      Override machine name
  --validate-only        Validate without generating
  -v, --verbose          Show counts and details
```

**Output**: `{output_dir}/{name}_fsm.{py|ts}`

## Structural Tensions

### Three Codegen Implementations
**Current Reality**: Python package (`codegen.py`), TypeScript package (`codegen.ts`), and MCP server (`server.ts` inline) each implement code generation independently
**Desired Outcome**: Single authoritative codegen per language, invoked by all consumers
**Resolution Path**: MCP `generate_code` → subprocess call to `smcg` CLI; web designer "Generate" → same path. The `codegen.py`/`codegen.ts` remain the single source of truth.

### TypeScript CLI Target
**Current Reality**: `smcg` CLI only supports `-l python`; TypeScript codegen exists in `ts/src/codegen.ts` but not wired to CLI
**Desired Outcome**: `smcg input.smdf.json -l typescript` produces TypeScript output
**Resolution Path**: Add TypeScript target to CLI dispatch, importing TS codegen or reimplementing in Python

### Parallel Region Code Generation
**Current Reality**: `PythonCodeGenerator` ignores `StateDef.parallel` — no region contexts generated
**Desired Outcome**: Parallel states generate sub-context classes with completion tracking (per CAISHEN Spec 62 `CoderParallel`)
**Resolution Path**: Implement `generate_parallel_context()` following the region instantiation pattern

## Creative Advancement Scenarios

### Scenario: End-to-End State Machine from Conversation
**Desired Outcome**: LLM agent designs FSM via MCP tools, generates working Python code, user runs it
**Current Reality**: MCP `generate_code` produces lightweight inline code missing actions, timers, nesting
**Natural Progression**: MCP tool calls `smcg` subprocess → full codegen with all features → agent delivers production code
**Resolution**: Agent-designed state machines generate the same quality code as CLI-designed ones

### Scenario: Web Designer to Running Code
**Desired Outcome**: User designs in web UI, clicks "Generate", gets downloadable Python file
**Current Reality**: "Generate" button exports JSON definition, not executable code
**Natural Progression**: Generate button → POST to backend API → `smcg` CLI → return generated code → CodePreview shows real Python
**Resolution**: Visual design produces executable code in one click

## Dependencies

- **Spec 70 (SMDF)**: Input format consumed by parser
- **Spec 71 (Runtime)**: Generated code imports runtime classes
- **Spec 73 (MCP Server)**: Should invoke this codegen, not reimplement
- **Spec 74 (Web Designer)**: Generate button should invoke this codegen
