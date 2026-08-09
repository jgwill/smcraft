# @miadi/stateloom-canvas

The SMDF design surface, as a component anyone can mount.

This is the stateloom designer's board with its store taken out: pan, zoom,
drill into composites, drag boxes, routed edges, settled event labels, touch
gestures and a navigation HUD — all driven by props, all styled by CSS
variables. Two applications draw the same board from it (the stateloom web
designer and forgewright), which is the whole reason it exists as a package.

```bash
npm install @miadi/stateloom-canvas
```

```tsx
import { useMemo, useState } from "react";
import { StateMachineCanvas, autoLayout, IDENTITY_VIEWPORT } from "@miadi/stateloom-canvas";
import "@miadi/stateloom-canvas/styles.css";

export function Board({ definition }) {
  const [viewport, setViewport] = useState(IDENTITY_VIEWPORT);
  const [path, setPath] = useState([]);
  const [positions, setPositions] = useState(() => autoLayout(definition));

  return (
    <StateMachineCanvas
      definition={definition}
      positions={positions}
      path={path}
      viewport={viewport}
      onViewportChange={setViewport}
      onStateMove={(name, box) => setPositions((p) => ({ ...p, [name]: box }))}
      onNavigateInto={(name) => setPath((p) => [...p, name])}
      onNavigateTo={(depth) => setPath((p) => p.slice(0, depth))}
    />
  );
}
```

## Navigation

| Gesture | What it does |
|---|---|
| Wheel / trackpad | Scroll the board |
| Shift + wheel | Scroll sideways |
| Ctrl/⌘ + wheel | Zoom, anchored at the cursor |
| Middle-drag, or Space + drag | Pan |
| Drag a box | Move that state (needs `onStateMove`) |
| Double-click a composite | Drill into it |
| Right-click | Context menu (needs `onContextMenu`) |
| One finger | Pan · **two fingers** pinch-zoom · **hold** opens the menu |
| ⤢ Fit in the HUD | Frame every box of the current level |

`Ctrl+Z` / `Ctrl+Shift+Z` / `Delete` are forwarded to `onUndo`, `onRedo` and
`onDeleteState` when those props are given, and are inert when they are not.

## Props

Required: `definition`, `positions`, `viewport`, `onViewportChange`.

Everything else is optional and additive — a canvas with no callbacks is a
read-only board you can still pan, zoom and drill. `readOnly` turns off dragging
and transition-drawing while leaving navigation intact. `fitKey` frames the
board whenever its value changes (pass a document id, so loading a diagram
lands it centred). A `ref` exposes `fit()`, `zoomIn()`, `zoomOut()`,
`resetZoom()` and `element()` for a toolbar that lives outside the canvas.

## Theming

Every colour is a CSS custom property declared on `.slc-pane` — none is written
into an SVG attribute. Re-skin the whole surface either with a partial `theme`
prop or by redeclaring the variables on any ancestor:

```css
.my-app {
  --slc-surface: #131110;   /* warm coal instead of slate */
  --slc-accent: #FF6D3B;
  --slc-node-fill: #1E1A17;
}
```

`CANVAS_THEME_VARS` names every variable the component reads.

## What comes with it

The layout, routing and viewport arithmetic lives in
[`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol)
and is re-exported here — `autoLayout`, `routeEdges`, `placeLabels`, `fitToBoxes`,
`zoomAt`, `viewportTransform` — so a host needs one dependency to draw a board.

Part of [smcraft / stateloom](https://github.com/jgwill/smcraft). MIT.
