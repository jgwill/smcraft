/**
 * Writing a rendered diagram to disk — the one place that decides *where* an
 * export lands and what it is called.
 *
 * Both callers that produce a file share this: `smcx render` on the terminal
 * and the MCP `render_diagram` tool an agent calls mid-conversation. The path
 * it returns is absolute on purpose — an agent is expected to hand it straight
 * to whatever opens a file, and a relative path is only ever right by luck.
 */
import { writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  diagramFileName,
  renderAscii,
  renderMermaid,
  type LayoutBox,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";
import { renderSvg, type SvgTheme } from "./svg.js";
import { svgToPng } from "./raster.js";

export type DiagramFormat = "svg" | "png" | "mermaid" | "ascii";

export const DIAGRAM_FORMATS: DiagramFormat[] = ["svg", "png", "mermaid", "ascii"];

const EXTENSION: Record<DiagramFormat, string> = {
  svg: ".svg",
  png: ".png",
  mermaid: ".mmd",
  ascii: ".txt",
};

export interface RenderDiagramOptions {
  format?: DiagramFormat;
  /** Explicit output path. Without it, the name is derived from `doc`. */
  out?: string;
  /** The project file being drawn — names the output when `out` is absent. */
  doc?: string;
  /** Pixel multiplier for `png`. Defaults to 2. */
  scale?: number;
  theme?: SvgTheme;
  title?: string | false;
  /** Hand-placed boxes, when the caller has a board of its own. */
  positions?: Record<string, LayoutBox>;
  /**
   * Name the file `[ep252--]<Machine>--<yyMMddHHmmss>.<ext>` beside the
   * document instead of overwriting one predictable path. Ignored when `out`
   * names a file outright.
   */
  stamp?: boolean;
  /** The clock behind `stamp`, so a caller can pin it. Defaults to now. */
  at?: Date;
}

export interface RenderedDiagram {
  path: string;
  format: DiagramFormat;
  bytes: number;
  /** Which rasterizer drew it — `png` only. */
  backend?: string;
  width?: number;
  height?: number;
}

/**
 * The default output path for `doc` in `format`: the document's name with its
 * `.smdf.json` (or `.json`) tail replaced by the format's extension.
 */
export function defaultOutputPath(doc: string, format: DiagramFormat): string {
  const base = resolve(doc).replace(/\.smdf\.json$/i, "").replace(/\.json$/i, "");
  return `${base}${EXTENSION[format]}`;
}

/**
 * The stamped alternative: a dated, episode-aware name in the document's own
 * directory, so repeated exports pile up as a record instead of replacing each
 * other. `ep252--InteractiveProduction--260730175243.png`.
 */
export function stampedOutputPath(
  doc: string,
  machine: string | undefined,
  format: DiagramFormat,
  at: Date
): string {
  const resolved = resolve(doc);
  const name = diagramFileName({
    doc: resolved,
    machine,
    format: EXTENSION[format].slice(1),
    at,
  });
  return join(dirname(resolved), name);
}

/** Render `def` as text. Returns null for `png`, which is not text. */
export function renderDiagramText(
  def: StateMachineDefinition,
  opts: RenderDiagramOptions = {}
): string | null {
  switch (opts.format ?? "svg") {
    case "mermaid":
      return renderMermaid(def);
    case "ascii":
      return renderAscii(def);
    case "svg":
      return renderSvg(def, { theme: opts.theme, title: opts.title, positions: opts.positions });
    default:
      return null;
  }
}

/** Render `def` and write it out, returning where it landed. */
export async function renderDiagramToFile(
  def: StateMachineDefinition,
  opts: RenderDiagramOptions = {}
): Promise<RenderedDiagram> {
  const format = opts.format ?? "svg";
  const doc = opts.doc ?? "./statemachine.smdf.json";
  const path = resolve(
    opts.out ??
      (opts.stamp
        ? stampedOutputPath(doc, def.settings?.name, format, opts.at ?? new Date())
        : defaultOutputPath(doc, format))
  );

  if (format === "png") {
    const svg = renderSvg(def, {
      theme: opts.theme,
      title: opts.title,
      positions: opts.positions,
    });
    const raster = await svgToPng(svg, path, { scale: opts.scale });
    return {
      path,
      format,
      bytes: statSync(path).size,
      backend: raster.backend,
      width: raster.width,
      height: raster.height,
    };
  }

  const text = renderDiagramText(def, { ...opts, format });
  if (text === null) throw new Error(`Unknown diagram format: ${format}`);
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return { path, format, bytes: statSync(path).size };
}
