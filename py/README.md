# miadi-stateloom-engine

The Python implementation of the stateloom state machine engine: SMDF parser, validator
(V001–V014), hierarchical runtime, and the `smcg` code generator.

> **Renamed from `smcraft`.** The distribution is now `miadi-stateloom-engine` and the
> import package is `stateloom` (was `smcraft`), matching the
> [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine)
> npm twin and the rest of the `@miadi/stateloom*` family. The `smcg` command keeps its
> name. Generated Python now emits `from stateloom.runtime import …`.

## Install

```bash
pip install miadi-stateloom-engine
```

## Generate code from a definition

```bash
smcg machine.smdf.json -o output/ -l python -v
```

The pipeline is: `.smdf.json` → parser → `EnrichedModel` (lookup maps) → validator
(V001–V014) → generator → a state enum, a base state class, leaf state classes, a context
class and feeder classes. Generated code imports its runtime from this package rather than
inlining it.

## Use it as a library

```python
from stateloom.parser import StateMachineParser
from stateloom.codegen import generate_python

parser = StateMachineParser()
model = parser.parse_file("machine.smdf.json")   # wrapped or bare JSON, both work
errors = parser.validate(model)
if not errors:
    generate_python("machine.smdf.json", "output/machine.py")
```

The parser accepts both shapes a `.smdf.json` is written in: the bare
`{settings, events, state}` of hand-authored files, and the `{"stateMachine": {…}}` that
`smcx`, the MCP server and the hub persist.

### Running a machine

```python
from stateloom.runtime import Context, State, StateKind, ObserverConsole
```

`Context` (sync) and `ContextAsync` (queued, background-processed) drive the machine;
`TransitionHelper` resolves the lowest common ancestor for hierarchical transitions;
observers (`ObserverNull`, `ObserverConsole`, `ObserverLogger`) hook entry, exit,
transition and timer events.

## Part of the stateloom stack

| package | registry | role |
|---|---|---|
| [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine) | npm | the TypeScript twin of this package |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | npm | patch ops, diff/apply, layout, export naming |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | npm | socket.io client |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | npm | the socket.io hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | npm | React 19 binding |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | npm | `smcx` |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | npm | the MCP server agents design through |
| [`@miadi/stateloom-skills`](https://www.npmjs.com/package/@miadi/stateloom-skills) | npm | installable agent skills |
| **`miadi-stateloom-engine`** | **PyPI** | **this package** |

Source and full documentation: https://github.com/jgwill/smcraft

## License

MIT © Guillaume Isabelle
