# Code Generator (SMCG)

> RISE Framework Specification
> References: CAISHEN Spec 62 (State Machine Code Generator)

**Spec ID**: 72
**Version**: 1.1
**Source**: Extracted from `py/stateloom/codegen.py`, `ts/src/codegen.ts`, `py/stateloom/cli.py`
**Implementation**: Python (`py/stateloom/codegen.py`, PyPI `miadi-stateloom-engine`), TypeScript (`ts/src/codegen.ts`, npm `@miadi/stateloom-engine/codegen`), CLI `smcg` (ships with the Python package)
**Revised**: 2026-09-20 — package rename; each engine generates its own language only; the three-implementation tension partially resolved

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

### TypeScriptCodeGenerator
Mirrors Python output structure adapted for TypeScript:
- `enum States { ... }`
- `class StateBase extends State { ... }`
- `class MyMachineContext extends Context { ... }`

Generated TypeScript imports the runtime by package name — `import { Context, State, TransitionHelper } from "@miadi/stateloom-engine/runtime"` — so the emitted file compiles wherever the package is installed.

**One engine, one target.** `@miadi/stateloom-engine` exports `TypeScriptCodeGenerator` and nothing else from `./codegen`; `stateloom.codegen` exports `PythonCodeGenerator` and `generate_python`. Neither engine generates the other's language. Documentation that reads "Python + TypeScript code generators" is describing the pair of packages, not either one.

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

**Output**: `{output_dir}/{name}_fsm.py` — snake_cased from the machine name (`TestMachine` → `test_machine_fsm.py`).

`-l` accepts `python` and nothing else today. A caller passing `typescript` gets an argparse error, which is what the web designer's TypeScript button currently hits (see the tension below).

## Structural Tensions

### Three Codegen Implementations — **partially resolved**
**Current Reality**: MCP `generate_code` and the web designer's `POST /api/generate` both shell out to the real `smcg` CLI. The MCP server keeps an inline `generatePythonFallback()` for hosts with no `smcg` on PATH, so the third implementation still exists — as a fallback now, not as the primary path
**Desired Outcome**: Single authoritative codegen per language, invoked by all consumers
**Resolution**: ✅ `smcg` is the primary path from every surface. ⬜ The fallback remains; a host without the Python package silently gets thinner output than one with it, and nothing in the returned text says which one produced it

### TypeScript CLI Target
**Current Reality**: `smcg` only accepts `-l python` (`cli.py`, `choices=["python"]`). `TypeScriptCodeGenerator` exists in `ts/src/codegen.ts` and is reachable programmatically, but no CLI reaches it — so the web designer's TypeScript generate path fails at the argparse boundary
**Desired Outcome**: `smcg input.smdf.json -l typescript` produces TypeScript output
**Resolution Path**: Either widen `smcg`'s choices and port the TS generator to Python, or give the TypeScript engine its own bin and have `/api/generate` and `generate_code` dispatch on language

### Parallel Region Code Generation
**Current Reality**: `PythonCodeGenerator` ignores `StateDef.parallel` — no region contexts generated
**Desired Outcome**: Parallel states generate sub-context classes with completion tracking (per CAISHEN Spec 62 `CoderParallel`)
**Resolution Path**: Implement `generate_parallel_context()` following the region instantiation pattern

## Creative Advancement Scenarios

### Scenario: End-to-End State Machine from Conversation
**Desired Outcome**: LLM agent designs FSM via MCP tools, generates working Python code, user runs it
**Current Reality**: ~~MCP `generate_code` produces lightweight inline code~~ — it calls `smcg` and falls back to the inline generator only when the CLI is absent
**Natural Progression**: MCP tool calls `smcg` subprocess → full codegen with all features → agent delivers production code
**Resolution**: ✅ Agent-designed state machines generate the same code as CLI-designed ones, on any host where the Python engine is installed

### Scenario: Web Designer to Running Code
**Desired Outcome**: User designs in web UI, clicks "Generate", gets downloadable Python file
**Current Reality**: ~~"Generate" button exports JSON definition~~ — `POST /api/generate` writes a temp `.smdf.json`, runs `smcg` with `execFileSync` (no shell, sanitized name), reads `{snake}_fsm.py` back and returns it into `CodePreview`
**Natural Progression**: landed for Python
**Resolution**: ✅ for Python. ⬜ for TypeScript, which reaches `smcg -l typescript` and is rejected

## Dependencies

- **Spec 70 (SMDF)**: Input format consumed by parser
- **Spec 71 (Runtime)**: Generated code imports runtime classes
- **Spec 73 (MCP Server)**: `generate_code` invokes `smcg`, with an inline fallback
- **Spec 74 (Web Designer)**: the Generate button invokes `smcg` through `POST /api/generate`
