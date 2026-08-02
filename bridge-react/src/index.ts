/**
 * @miadi/stateloom-react
 *
 * Reusable React binding for the smcraft real-time design bridge. Exposes the
 * framework-agnostic `createBridgeSession` core (unit-testable, no React) and
 * the `useSmcraftBridge` hook that wraps it via `useSyncExternalStore`.
 */
export { createBridgeSession } from "./session.js";
export type {
  BridgeSession,
  BridgeSessionOptions,
  SessionSnapshot,
} from "./session.js";

export { useSmcraftBridge } from "./useSmcraftBridge.js";
export type {
  UseSmcraftBridge,
  UseSmcraftBridgeOptions,
} from "./useSmcraftBridge.js";

export { autoLayout, AUTO_LAYOUT_DEFAULTS } from "./autoLayout.js";
export type { AutoLayoutOptions, LayoutBox } from "./autoLayout.js";

// Edge routing and label settling. Pure geometry from the protocol, re-exported
// here because the designer canvas reaches for its drawing helpers at this
// address and should not have to know which package underneath a curve was
// bent, or a chip's spot computed, in.
export {
  routeEdges,
  edgeCurve,
  selfLoopCurve,
  facingSides,
  portAt,
  placeLabels,
  chipSize,
  glyphAt,
  textWidth,
  guardText,
  eventGlyph,
  ALL_GLYPHS,
  PORT_PITCH,
  SELF_LOOP_BULGE,
  LABEL_FONT_SIZE,
  GUARD_FONT_SIZE,
  GUARD_MAX_CHARS,
  GLYPH_SIZE,
  GLYPH_INSET,
  GLYPH_COLUMN,
} from "@miadi/stateloom-protocol";
export type {
  EdgeCurve,
  EdgeEnds,
  EdgeSide,
  Glyph,
  PendingLabel,
  PlacedLabel,
  PlaceLabelsOptions,
} from "@miadi/stateloom-protocol";

export {
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
} from "./viewport.js";
export type { Box, FitOptions, Point, ScaleLimits, Viewport } from "./viewport.js";
