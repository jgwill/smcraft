/**
 * @miadi/stateloom-canvas
 *
 * The SMDF design surface as a mountable React component: pan, zoom, drill,
 * drag, routed edges, settled labels, touch gestures and a navigation HUD —
 * driven entirely by props, styled entirely by CSS variables.
 *
 *     import { StateMachineCanvas } from "@miadi/stateloom-canvas";
 *     import "@miadi/stateloom-canvas/styles.css";
 *
 * The arithmetic underneath (`autoLayout`, `routeEdges`, `placeLabels`, the
 * viewport transforms) lives in `@miadi/stateloom-protocol` and is re-exported
 * here, so a host needs one dependency to draw a board rather than two.
 */
export { StateMachineCanvas, default } from "./StateMachineCanvas.js";
export type {
  CanvasSelection,
  CanvasTarget,
  DrawMode,
  StateMachineCanvasHandle,
  StateMachineCanvasProps,
} from "./StateMachineCanvas.js";

export { EntityRelationshipCanvas } from "./EntityRelationshipCanvas.js";
export type { EntityRelationshipCanvasProps, ErdCanvasTarget } from "./EntityRelationshipCanvas.js";

export { themeStyle, CANVAS_THEME_VARS } from "./theme.js";
export type { CanvasTheme } from "./theme.js";

export {
  childByName,
  childStatesAt,
  childrenOf,
  definedEvents,
  findState,
  livePath,
  parentAt,
} from "./drill.js";

// The geometry and the model, re-exported at the address a host reaching for a
// canvas is already looking at.
export {
  autoLayout,
  AUTO_LAYOUT_DEFAULTS,
  IDENTITY_VIEWPORT,
  VIEWPORT_LIMITS,
  clampScale,
  fitToBoxes,
  normalizeViewport,
  panBy,
  sameViewport,
  screenDeltaToWorld,
  screenToWorld,
  viewportTransform,
  worldToScreen,
  zoomAt,
  zoomTo,
  routeEdges,
  erdAutoLayout,
  erdEntitySize,
  placeLabels,
  eventGlyph,
  guardText,
} from "@miadi/stateloom-protocol";
export type {
  AutoLayoutOptions,
  Box,
  EntityRelationshipDefinition,
  FitOptions,
  LayoutBox,
  Point,
  ScaleLimits,
  StateDef,
  StateMachineDefinition,
  TransitionDef,
  Viewport,
} from "@miadi/stateloom-protocol";
