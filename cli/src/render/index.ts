/**
 * `@miadi/stateloom-cli/render` — the renderers, without the command shell.
 *
 * The MCP server draws the same diagrams the terminal does and must not boot a
 * commander program to do it, so every renderer is reachable from this entry
 * point alone. Nothing here reads argv or writes to stdout.
 */
// The two text renderers live in the protocol now — the web designer draws
// mermaid client-side, and it cannot import a package that reaches for
// `node:child_process`. Re-exported here so this entry point stays whole.
export { renderAscii, renderMermaid } from "@miadi/stateloom-protocol";
export { renderSvg } from "./svg.js";
export type { SvgRenderOptions, SvgTheme } from "./svg.js";
export { svgToPng, svgSize } from "./raster.js";
export type { RasterOptions, RasterResult } from "./raster.js";
export {
  renderDiagramToFile,
  renderDiagramText,
  defaultOutputPath,
  stampedOutputPath,
  DIAGRAM_FORMATS,
} from "./file.js";
export type { DiagramFormat, RenderDiagramOptions, RenderedDiagram } from "./file.js";
