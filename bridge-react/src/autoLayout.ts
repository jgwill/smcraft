/**
 * The layered layout derivation, re-exported from where it now lives.
 *
 * The algorithm moved down into `@miadi/stateloom-protocol` once headless
 * renderers (`smcx render`, the MCP `render_diagram` tool) needed the same
 * boxes the canvas draws — none of them can depend on a React package. This
 * shim keeps `@miadi/stateloom-react`'s surface exactly as it was: the web
 * store, the layout memory, and this package's own tests all still import
 * `autoLayout` from here.
 */
export { autoLayout, AUTO_LAYOUT_DEFAULTS } from "@miadi/stateloom-protocol";
export type { AutoLayoutOptions, LayoutBox } from "@miadi/stateloom-protocol";
