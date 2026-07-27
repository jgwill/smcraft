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
