/**
 * @miadi/stateloom-protocol
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
export * from "./env.js";
export {
  collectAllStates,
  collectStateNames,
  collectEventIds,
  buildParentMap,
} from "./tree.js";
export { autoLayout, AUTO_LAYOUT_DEFAULTS } from "./autoLayout.js";
export type { AutoLayoutOptions, LayoutBox } from "./autoLayout.js";
export { renderMermaid } from "./render/mermaid.js";
export { renderAscii } from "./render/ascii.js";
export { diagramFileName, timeStamp, episodeOf } from "./exportName.js";
export type { DiagramNameInput } from "./exportName.js";
