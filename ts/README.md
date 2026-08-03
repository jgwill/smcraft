# smcraft

[![npm](https://img.shields.io/npm/v/smcraft)](https://www.npmjs.com/package/smcraft)

State Machine Craft — parse, validate, run, and generate code from hierarchical state machines described in a single JSON file.

## Install

```bash
npm install smcraft
```

## What it is

`smcraft` reads a **State Machine Definition Format** document (`.smdf.json`): settings, event sources, and one nested tree of states with transitions. From that document it gives you four things — a parser, a rule-coded validator, an interpreter that drives the machine at runtime, and code generators that emit standalone TypeScript or Python classes.

It is not a hub, a UI, or a network protocol. Nothing here opens a socket or touches a browser. The live design surfaces — the socket.io hub, the CLI, the React canvas, the MCP server — are the `@miadi/stateloom-*` packages listed below, and they read the same `.smdf.json` this engine runs.

A Python twin ships on PyPI under the same name (`pip install smcraft`, CLI `smcg`) with the same definition format.

## Usage

Drive a definition directly with the `Machine` interpreter. The constructor validates, builds the state tree, and enters the initial leaf state:

```ts
import { Machine, listTransitions, type StateMachineDefinition } from "smcraft";

const def: StateMachineDefinition = {
  settings: { namespace: "shop", name: "OrderWorkflow", asynchronous: false },
  events: [
    { name: "OrderEvents", events: [{ id: "approve" }, { id: "ship" }] },
  ],
  state: {
    name: "Root",
    states: [
      { name: "Pending", transitions: [{ event: "approve", nextState: "Approved" }] },
      { name: "Approved", transitions: [{ event: "ship", nextState: "Shipped" }] },
      { name: "Shipped", kind: "final" },
    ],
  },
};

const machine = new Machine(def);

machine.state;              // "Pending"
machine.path;               // ["Root", "Pending"]
machine.availableEvents();  // ["approve"]

const r = machine.send("approve");
// { handled: true, changed: true, from: "Pending", to: "Approved", event: "approve" }

machine.send("ship");
machine.done;               // true
machine.visited;            // ["Pending", "Approved", "Shipped"]

listTransitions(def);       // every edge, flattened, for graph ingest
```

Guards are condition strings on a transition. The default guard reads them as truthy keys of a context object; pass your own `guard` to evaluate them however you like:

```ts
const withContext = new Machine(def, { context: { paymentCleared: true } });

const withCustomGuard = new Machine(def, {
  guard: (condition, payload, ctx) => evaluate(condition, { ...ctx, ...payload }),
});
```

Parse from disk, validate, and generate code:

```ts
import { parseFile, enrich, validate, TypeScriptCodeGenerator } from "smcraft";

const definition = parseFile("./order.smdf.json");
const model = enrich(definition);            // adds stateMap / parentMap / allStates

for (const e of validate(model)) {
  console.error(`${e.ruleId} ${e.message}`); // e.g. "V006 Undefined state: Shiped"
}

const source = new TypeScriptCodeGenerator(model).generate();
```

`Machine` throws `MachineDefinitionError` on the fatal rules (`V001` no root state, `V002` duplicate state name, `V006` transition targets an undefined state) and collects the rest on `machine.warnings`. The TypeScript validator implements `V001`, `V002`, `V003`, `V005`, `V006`, `V007` and `V013`; the Python build carries the full `V001`–`V014` set.

## Subpath exports

| Import | Contents |
|---|---|
| `smcraft` | Everything below, re-exported |
| `smcraft/runtime` | `Context`, `ContextAsync`, `ContextBase`, `State`, `StateKind`, `TransitionHelper`, `ObserverNull`, `ObserverConsole` |
| `smcraft/machine` | `Machine`, `MachineDefinitionError`, `listTransitions` |
| `smcraft/parser` | `parseJson`, `parseFile`, `enrich`, `validate` |
| `smcraft/codegen` | `TypeScriptCodeGenerator` |

Generated code imports from `smcraft/runtime`, so the runtime is a dependency of what the generator emits — not a build-time artifact.

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`smcraft`](https://www.npmjs.com/package/smcraft) | State machine engine: parser, validator, interpreter, code generators — **this package** |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — zero runtime deps |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines |

## License

MIT © Guillaume Isabelle
