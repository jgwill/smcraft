/**
 * @smcraft/bridge
 *
 * socket.io hub for the smcraft real-time design bridge. `startBridge(opts)`
 * boots a sequencer + broadcaster + external-edit differ that never writes disk.
 */
export { startBridge } from "./hub.js";
export type {
  StartBridgeOpts,
  BridgeHandle,
  Room,
  RingEntry,
  LivePresence,
} from "./hub.js";
export { DEDUP_RING_SIZE } from "./hub.js";
export { normalizeDocId, readDefFile, mtimeOf } from "./docio.js";
export { watchRoom, type RoomWatcher } from "./watcher.js";
