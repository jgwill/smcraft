/**
 * @smcraft/bridge-react
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
