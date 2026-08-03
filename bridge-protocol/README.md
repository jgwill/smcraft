# @miadi/stateloom-protocol

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-protocol)](https://www.npmjs.com/package/@miadi/stateloom-protocol)

The zero-runtime-dependency foundation of the stateloom real-time design bridge: SMDF types, the patch-op vocabulary, a pure diff/apply pair, wire envelopes, layout and label geometry, and the text renderers.

## Install

```bash
npm install @miadi/stateloom-protocol
```

## What it is

Every other stateloom package depends on this one and this one depends on nothing. It holds the shared vocabulary — what a change to a state machine *is* (`PatchOp`), how two definitions differ (`diffDefinition`), how a patch lands (`applyPatchOps`), what goes over the socket (`EV`, the envelopes), where the boxes sit (`autoLayout`), and how a diagram is named on export.

It is not a client and not a server. It opens no socket, reads no file, and imports nothing from `node:` — which is what lets the browser canvas, the hub, the CLI and the MCP server all agree on the same geometry and the same wire format without any of them pulling the others in.

## Usage

Diff two definitions into patch ops, then apply them somewhere else. `applyPatchOps` is pure — it clones and returns, never mutating its input:

```ts
import { diffDefinition, applyPatchOps, hashDef } from "@miadi/stateloom-protocol";
import type { PatchOp, StateMachineDefinition } from "@miadi/stateloom-protocol";

const ops: PatchOp[] = diffDefinition(previous, next);
// [{ op: "state.add", parent: "Root", state: { name: "Shipped", kind: "final" } },
//  { op: "transition.add", state: "Approved", transition: { event: "ship", nextState: "Shipped" } }]

const rebuilt = applyPatchOps(previous, ops);
hashDef(rebuilt) === hashDef(next); // true — round-trip
```

The op vocabulary covers `settings.update`; `state.add|update|remove|nest`; `eventSource.add|update|remove`; `event.add|update|remove`; `parameter.add|update|remove`; `transition.add|update|remove`; `action.add|update|remove`; and the two runtime markers `runtime.enter` / `runtime.exit` that light a state up on a live canvas without changing the document.

Lay out and draw the same board any surface draws. `autoLayout` is deterministic — the same definition always yields byte-identical boxes:

```ts
import { autoLayout, renderMermaid, renderAscii } from "@miadi/stateloom-protocol";

const boxes = autoLayout(def);          // { Pending: { x, y, width, height }, ... }
const mmd = renderMermaid(def);         // stateDiagram-v2 source
const art = renderAscii(def, new Set(["Approved"])); // terminal view, active state marked
```

Name an export the way every surface names it — `[ep252--]<Machine>--<yyMMddHHmmss>.<ext>`:

```ts
import { diagramFileName, episodeOf } from "@miadi/stateloom-protocol";

diagramFileName({ doc, machine: def.settings.name, format: "png", at: new Date() });
// "ep103--FilmPreprod--260803093500.png"
episodeOf("/srv/.../2026-06-28-episode-103-film-preprod/diagrams/x.smdf.json"); // "ep103"
```

Read environment configuration through `envAlias`, which prefers the current `STATELOOM_*` names and falls back to the legacy `SMCRAFT_*` twins:

```ts
import { envAlias } from "@miadi/stateloom-protocol";

const url = envAlias("BRIDGE_URL");   // STATELOOM_BRIDGE_URL ?? SMCRAFT_BRIDGE_URL
const doc = envAlias("PROJECT_FILE"); // STATELOOM_PROJECT_FILE ?? SMCRAFT_PROJECT_FILE
```

## Exports

| Area | Names |
|---|---|
| Definition types | `StateMachineDefinition`, `StateDef`, `EventDef`, `EventSourceDef`, `TransitionDef`, `ActionDef`, `SettingsModel` |
| Patch | `PatchOp`, `diffDefinition`, `applyPatchOps` |
| Wire | `EV`, `Role`, `Presence`, `DocSnapshot`, `PatchEnvelope`, `FullEnvelope`, `colorFor` |
| Sequencing | `hashDef`, `nextSeq` |
| Tree | `collectAllStates`, `collectStateNames`, `collectEventIds`, `buildParentMap` |
| Layout | `autoLayout`, `AUTO_LAYOUT_DEFAULTS`, `LayoutBox` |
| Edges & labels | `routeEdges`, `edgeCurve`, `selfLoopCurve`, `facingSides`, `portAt`, `bezier`, `placeLabels`, `chipSize`, `glyphAt`, `textWidth`, `guardText`, `eventGlyph`, `ALL_GLYPHS` |
| Render | `renderMermaid`, `renderAscii` |
| Export naming | `diagramFileName`, `timeStamp`, `episodeOf` |
| Environment | `envAlias` |

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`smcraft`](https://www.npmjs.com/package/smcraft) | State machine engine: parser, validator, interpreter, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — **this package** |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines |

## License

MIT © Guillaume Isabelle
