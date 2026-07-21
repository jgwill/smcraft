/**
 * @smcraft/bridge-client
 *
 * Framework-agnostic socket.io-client wrapper for the smcraft real-time design
 * bridge. Re-exports the factory and its public types.
 */
export {
  createBridgeClient,
} from "./client.js";
export type {
  BridgeClient,
  BridgeClientOptions,
  BridgeEvent,
  BridgeStatus,
  JoinResult,
  AckPayload,
} from "./client.js";
