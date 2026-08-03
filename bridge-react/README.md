# @miadi/stateloom-react

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-react)](https://www.npmjs.com/package/@miadi/stateloom-react)

React binding for the stateloom real-time design bridge: a `useSmcraftBridge` hook over `useSyncExternalStore`, plus the framework-agnostic session core it wraps and the geometry a canvas needs to draw the result.

## Install

```bash
npm install @miadi/stateloom-react
```

`react ^19` is a peer dependency — this package uses the version already in your app.

## What it is

Two layers. `createBridgeSession` is a plain object that keeps an immutable snapshot of the live document (`status`, `def`, `seq`, `presence`, `activeStates`) and lets you subscribe to it — no React involved, so it is unit-testable on its own. `useSmcraftBridge` is the thin hook that creates one session per mount, reads its snapshot through `useSyncExternalStore`, and memoises the imperative callbacks so your `useEffect` and `memo` dependencies stay stable.

It is not a component library — no canvas, no styling, no rendered state machine. It gives you the live data and the geometry helpers; what you draw with them is yours.

## Usage

```tsx
import { useSmcraftBridge, autoLayout, viewportTransform, fitToBoxes } from "@miadi/stateloom-react";

function Designer({ docId }: { docId: string }) {
  const bridge = useSmcraftBridge({
    url: "http://127.0.0.1:4599",
    role: "web",
    docId,                       // an absolute .smdf.json path — rooms are keyed by it
    name: "guillaume@browser",
  });

  if (!bridge.def) return <p>{bridge.status}</p>;

  const boxes = autoLayout(bridge.def);
  const view = fitToBoxes(Object.values(boxes), 1200, 800);

  return (
    <>
      <p>{bridge.presence.length} here · seq {bridge.seq}</p>

      <svg width={1200} height={800}>
        <g transform={viewportTransform(view)}>
          {Object.entries(boxes).map(([name, b]) => (
            <rect
              key={name}
              x={b.x} y={b.y} width={b.width} height={b.height}
              className={bridge.activeStates.includes(name) ? "active" : undefined}
            />
          ))}
        </g>
      </svg>

      <button
        onClick={() =>
          bridge.emitPatch([
            { op: "state.add", parent: "Root", state: { name: "Shipped", kind: "final" } },
          ])
        }
      >
        Add state
      </button>
    </>
  );
}
```

`autoConnect` defaults to true: the hook connects and joins on mount and disconnects on unmount. Set it to `false` and call `bridge.connect()` yourself when you want to control the timing.

### What the hook gives you

| Field | Meaning |
|---|---|
| `status` | `connecting` \| `connected` \| `disconnected` \| `error` |
| `def` | The live definition, or `null` before the first frame |
| `seq` | Hub-assigned sequence of the last frame applied |
| `presence` | Everyone in this document's room |
| `activeStates` | States lit by `runtime.enter` / `runtime.exit` markers |
| `emitPatch(ops)` / `emitFull(def)` | Send a change |
| `enter(state, from?, eventId?)` / `exit(state)` | Light a state up without changing the document |
| `connect()` / `disconnect()` | Manual lifecycle |

Options extend `BridgeClientOptions` from [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) and add `onFull`, `onPatch`, `onPresence` for consumers keeping their own store.

### Geometry, re-exported

`autoLayout` and `AUTO_LAYOUT_DEFAULTS`; the edge and label helpers `routeEdges`, `edgeCurve`, `selfLoopCurve`, `facingSides`, `portAt`, `placeLabels`, `chipSize`, `glyphAt`, `textWidth`, `guardText`, `eventGlyph`; and the viewport helpers `fitToBoxes`, `zoomAt`, `zoomTo`, `panBy`, `screenToWorld`, `worldToScreen`, `screenDeltaToWorld`, `clampScale`, `normalizeViewport`, `viewportTransform`, `sameViewport`, `IDENTITY_VIEWPORT`, `VIEWPORT_LIMITS`. A canvas reaches for its drawing helpers at this one address and never has to know which package underneath a curve was bent in.

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`smcraft`](https://www.npmjs.com/package/smcraft) | State machine engine: parser, validator, interpreter, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — zero runtime deps |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client — **this package** |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines |

## License

MIT © Guillaume Isabelle
