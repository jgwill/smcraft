---
name: stateloom-codegen
description: Turn a stateloom / smcraft .smdf.json state machine into runnable Python or TypeScript. Use when generating code with smcg or the generate_code MCP tool, validating a definition against V001-V014 before generating, running smcg --validate-only, wiring the smcraft runtime that generated code imports, running or testing a generated state machine, or diagnosing "Error parsing …: 'settings'" and lightweight fallback output.
---

# SMDF → validated → code

```
  machine.smdf.json
        │
        ▼
     Parser ──────────► EnrichedModel
        │                 state_map · event_map · timer_map
        │                 feeders_map · parent_map
        │                 all_states · leaf_states · composite_states
        ▼
   Validator  V001–V014
        │  (clean)
        ▼
   Generator ─────────► <machine>_fsm.py   (Python)
        │                <machine>_fsm.ts   (TypeScript)
        ▼
   your code imports the smcraft runtime and drives it
```

The runtime — `Context`, `ContextAsync`, `State`, `StateKind`, `TransitionHelper`,
`ObserverNull` — **ships as a dependency**. Generated code imports it; it is never inlined.
Install `smcraft` (PyPI for Python, npm for TypeScript) alongside the generated file.

---

## Step 1 — Validate before you generate

Generation on an invalid definition wastes a cycle. Validate first.

```bash
smcg /abs/path/machine.smdf.json --validate-only
```

Clean:

```
Validation passed.
```

Not clean — the rule ID tells you what to fix (full table in the `stateloom-design` skill's
`smdf-reference.md`):

```
Validation errors in /abs/path/machine.smdf.json:
  [V005] Transition references undefined event: OrderApprove (Pending)
  [V006] Transition references undefined state: Complete (Active)
  2 error(s) found
```

Exit code is non-zero when any rule fires, so it gates a build:

```bash
smcg "$DEF" --validate-only || { echo "definition is not ready"; exit 1; }
```

The MCP `validate_definition` tool is a **different, smaller** check with overlapping rule
IDs. Use it while designing; use `smcg --validate-only` before generating.

---

## Step 2 — Unwrap, if the file came from the tools

Every writer in the live loop — the MCP server, `smcx`, the web designer — persists the
**wrapped** form:

```json
{ "stateMachine": { "settings": …, "events": …, "state": … } }
```

`smcg` does not accept that wrapper. Handing it a wrapped file fails with:

```
Error parsing /abs/path/machine.smdf.json: 'settings'
```

This is a `smcg` (Python) constraint. The TypeScript engine's `parseFile` / `parseJson` unwrap
`{ "stateMachine": … }` themselves in current `smcraft` — but unwrapping first works on every
version of both engines, so make it the habit.

Unwrap first:

```bash
jq '.stateMachine // .StateMachine // .' /abs/path/machine.smdf.json > /tmp/machine.bare.smdf.json

# without jq
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); json.dump(d.get('stateMachine', d.get('StateMachine', d)), open(sys.argv[2],'w'), indent=2)" \
  /abs/path/machine.smdf.json /tmp/machine.bare.smdf.json
```

Files written by hand (and the repository's `examples/*.smdf.json`) are already bare — check
with `head -3` before converting.

---

## Step 3 — Generate Python

```bash
pip install smcraft                       # runtime + parser + generator + the smcg CLI

smcg /tmp/machine.bare.smdf.json -o ./generated/ -l python -v
```

```
Validation passed: 6 states, 3 events
Generated: ./generated/traffic_light_fsm.py
  States: 6
  Events: 3
  Feeders: 1
```

| Option | Meaning |
|---|---|
| `-o, --output <dir>` | Output directory (default: cwd). Created if missing. |
| `-l, --language <lang>` | Target. **`python` is the only accepted value.** |
| `-n, --name <name>` | Override `settings.name` for this run |
| `--validate-only` | Validate and stop |
| `-v, --verbose` | Print state / event / feeder counts |

**Output filename is snake_case:** `settings.name` `TrafficLight` → `traffic_light_fsm.py`.
Newer builds of the CLI also accept `smcg generate <input> …` as an explicit subcommand; the
bare positional form shown above works on both.

---

## Step 4 — Run the generated Python

The generated module gives you a context class named `<Name>Context`, one class per **leaf**
state, an `IntEnum` of every state, and a feeder per event source.

```python
from traffic_light_fsm import TrafficLightContext

ctx = TrafficLightContext()
ctx.enter_initial_state()          # required — nothing is entered until you call it
print(ctx.state_current.name)      # → Red

ctx.on_timer_elapsed()             # one method per event, snake_cased from the event id
print(ctx.state_current.name)      # → Green
```

Event methods on the context forward to whatever leaf is current:

```python
def on_timer_elapsed(self) -> None:
    if self.state_current:
        self.state_current.on_timer_elapsed(self)
```

Events carrying parameters take them positionally, typed as declared in the SMDF:
`ctx.on_pedestrian_call("north-crossing")`.

### Three generator behaviours to know before you rely on the output

All three verified by running the generator.

1. **An internal transition with no actions emits an empty handler — invalid Python.**
   A transition with no `nextState` and no `actions` produces
   `def on_x(self, context) -> None:` with nothing under it, and importing the module raises
   `IndentationError: expected an indented block after function definition`.
   Give every internal transition at least one action:

   ```json
   { "event": "ARTEFACT_TYPED", "actions": [ { "code": "on_artefact_typed_noop()" } ] }
   ```

   Diagnose it in one line before you import:

   ```bash
   python3 -m py_compile ./generated/*_fsm.py && echo "compiles"
   ```

2. **Handlers are emitted on leaf states only.** A composite is emitted as a plain
   `State(kind=StateKind.COMPOSITE)`, so a transition declared on a composite is **not**
   dispatched to its children at runtime, even though it is correct in the model and draws in
   every diagram. To make a shared exit executable, declare it on each leaf as well.

3. **Parallel regions are not generated.** `StateDef.parallel` is modelled and validated
   (V010, V011) but the generator emits no region contexts. Check the output before depending
   on it.

### Where your own logic goes

The generated file is regenerated wholesale — its header says *Do not edit manually*, and it
means it. Put behaviour in:

- `condition` expressions in the SMDF — emitted verbatim as guards
- `actions` on transitions, and `onEntry` / `onExit` blocks — each `{ "code": "…" }` is emitted
  as **`context.<code>`**, so write `"initialize()"`, never `"self.initialize()"`
- an **observer**: the runtime calls entry / exit hooks, so a custom observer sees every
  transition without touching generated code
- a subclass of the generated context, in your own file — this is where the methods your
  actions call actually live:

```python
from traffic_light_fsm import TrafficLightContext

class MyLight(TrafficLightContext):
    def open_ledger(self):        # called by { "code": "open_ledger()" }
        ...

ctx = MyLight()
ctx.enter_initial_state()
```

---

## Step 5 — TypeScript

The TypeScript generator exists in the npm `smcraft` package but is **not wired to any CLI**.
`smcg -l typescript` is rejected by argparse — `python` is the only choice.

Generate programmatically:

```bash
npm install smcraft
```

```js
// generate-ts.mjs
import { parseFile, enrich, validate } from "smcraft/parser";
import { TypeScriptCodeGenerator } from "smcraft/codegen";
import { writeFileSync } from "node:fs";

const def = parseFile("/tmp/machine.bare.smdf.json");
const model = enrich(def);

const errors = validate(model);
if (errors.length) {
  for (const e of errors) console.error(`[${e.ruleId}] ${e.message}`);
  process.exit(1);
}

writeFileSync("./generated/traffic_light_fsm.ts", new TypeScriptCodeGenerator(model).generate());
```

```bash
node generate-ts.mjs && head -20 ./generated/traffic_light_fsm.ts
```

**Fix the import line.** The generated TypeScript imports its runtime relatively:

```ts
} from "./runtime.js";
```

That is right only if the file sits next to the runtime. In your own project, rewrite it:

```bash
sed -i 's|} from "./runtime.js";|} from "smcraft/runtime";|' ./generated/traffic_light_fsm.ts
```

Then use it the same way as Python, camelCased:

```ts
import { TrafficLightContext } from "./generated/traffic_light_fsm.js";

const ctx = new TrafficLightContext();
ctx.enterInitialState();
ctx.onTimerElapsed();
```

The npm `smcraft` package also ships a `Machine` interpreter (`smcraft/machine`) that runs an
SMDF definition directly, with no code generation step — reach for it when you want to
*execute* a definition rather than compile it.

---

## Generating through MCP

```
generate_code { "language": "python" }
generate_code { "language": "typescript" }
```

The tool validates first with the MCP's own rules and refuses on errors:

```
Fix validation errors first:
[V003] State 'Pending' references unknown event 'OrderApprove'
```

When clean, it unwraps the definition into a temp file, calls `smcg`, and returns the code as
text.

### Know which generator produced your code — verified behaviour

`generate_code` silently falls back to a lightweight inline generator whenever the `smcg`
subprocess does not hand back the file it expected. Two situations trigger it, and both are
common:

- **`language: "typescript"`** — `smcg` rejects `-l typescript`, so TypeScript from this tool
  is *always* the fallback.
- **A `settings.name` that is not already snake_case** — `smcg` writes
  `interactive_production_fsm.py` while the tool looks for `InteractiveProduction_fsm.py`, does
  not find it, and falls back.

Tell them apart by the first line:

| First line | Generator | What you get |
|---|---|---|
| `"""Generated State Machine: <Name>"""` | Full `smcg` | `IntEnum`, entry/exit chains, guards, timers, feeder classes, `enter_initial_state` |
| `"""Generated by SMCraft"""` | Lightweight fallback | States and transitions only — no feeders, no entry/exit, no initial-state entry |

**For production code, run `smcg` on the file yourself** (Steps 2–3). Use `generate_code` to
sketch and to read structure inside a conversation.

If you want the MCP path to produce full output, name the machine in snake_case
(`settings.name: "order_workflow"`) so the expected and actual filenames coincide.

---

## End-to-end, one pass

```bash
DEF=/abs/path/machine.smdf.json
OUT=./generated

jq '.stateMachine // .StateMachine // .' "$DEF" > /tmp/bare.smdf.json
smcg /tmp/bare.smdf.json --validate-only || exit 1
smcg /tmp/bare.smdf.json -o "$OUT" -l python -v

# catches the empty-handler defect before it becomes a confusing traceback
python3 -m py_compile "$OUT"/*_fsm.py || { echo "generated code does not compile — see behaviour 1"; exit 1; }

python3 - <<'PY'
import glob, importlib.util, sys
path = glob.glob("./generated/*_fsm.py")[0]
spec = importlib.util.spec_from_file_location("fsm", path)
mod  = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
ctx  = next(getattr(mod, n)() for n in dir(mod) if n.endswith("Context"))
ctx.enter_initial_state()
print("initial state:", ctx.state_current.name)
PY
```

Passing means the definition parses, validates, generates, imports and enters its initial
state — the whole pipeline proven in one run.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error parsing …: 'settings'` | Wrapped `{ "stateMachine": … }` handed to `smcg` | Unwrap (Step 2) |
| `IndentationError: expected an indented block after function definition` | An internal transition with no `actions` produced an empty handler | Add an action to every `nextState`-less transition (behaviour 1) |
| `AttributeError: '<Name>Context' object has no attribute 'x'` | An action's `code` is emitted as `context.x` and nothing implements `x` | Implement it on a subclass of the generated context |
| `smcg: error: argument -l/--language: invalid choice: 'typescript'` | `smcg` only targets Python | Generate TypeScript programmatically (Step 5) |
| `ModuleNotFoundError: No module named 'smcraft'` | Runtime not installed where the generated file runs | `pip install smcraft` |
| `Cannot find module './runtime.js'` | Generated TS still has the relative import | Rewrite to `smcraft/runtime` |
| Output is far smaller than expected | The lightweight fallback ran | Check the first line; run `smcg` directly |
| Machine does not react to an event | The transition is on a composite, not a leaf | Declare it on each leaf too |
| `[V0xx]` errors you do not recognize | Canonical rules, not the MCP subset | See `smdf-reference.md` in `stateloom-design` |
| Generated file name is not what you expected | `smcg` snake_cases `settings.name` | `TrafficLight` → `traffic_light_fsm.py`; override with `-n` |
