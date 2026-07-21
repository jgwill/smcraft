/**
 * @smcraft/bridge-protocol
 *
 * Pure, zero-runtime-dependency foundation of the smcraft real-time design
 * bridge: SMDF types, the PatchOp vocabulary, a pure diff/apply pair, wire
 * envelopes/event names, and small seq/hash helpers.
 */
export * from "./definition.js";
export * from "./ops.js";
export * from "./apply.js";
export * from "./diff.js";
export * from "./seq.js";
export * from "./events.js";
export {
  collectAllStates,
  collectStateNames,
  collectEventIds,
  buildParentMap,
} from "./tree.js";
