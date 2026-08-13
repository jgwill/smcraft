"use client";

/**
 * Exporting the board as a picture — the browser half of `smcx render`.
 *
 * The CLI redraws a definition from scratch; here the board is already on the
 * screen as SVG, so the export *is* the canvas, cloned and cleaned. That is the
 * point: what a designer sees, including every box they dragged by hand, is
 * what lands in the file. Nothing is re-derived, so nothing can disagree.
 *
 * Cleaning means three things, each answering a way the live canvas is not a
 * picture: the viewport transform comes off (an export frames the whole board,
 * not the current pan), the invisible fingertip cuffs go (they exist to catch
 * touches, and a `fill="transparent"` rect in a still is only a bigger file),
 * and the font moves onto the root element (an SVG loaded as an image is
 * sandboxed away from the page's stylesheet, and unstated text would come back
 * in the default serif).
 */

import { diagramFileName, renderMermaid } from "@miadi/stateloom-protocol";
import type { StateMachineDefinition } from "@miadi/stateloom-protocol";

/** The id the canvas `<svg>` carries so an export can find it. */
export const CANVAS_SVG_ID = "stateloom-canvas";

/** Fonts named on the export root, since page CSS cannot reach inside it. */
const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const BACKGROUND = "#030712";

/**
 * What the board can be exported as.
 *
 * `mermaid` and `markdown` are the same diagram in text: the bare
 * `stateDiagram-v2` source for a `.mmd` file a renderer picks up directly, and
 * the fenced snippet for pasting into a README, an issue, or a chronicle page.
 * Both come from the definition rather than the canvas — mermaid describes a
 * graph, not a placement, so there is no board geometry for it to carry.
 */
export type ExportFormat = "png" | "jpeg" | "svg" | "mermaid" | "markdown";

export const EXPORT_FORMATS: ExportFormat[] = ["png", "jpeg", "svg", "mermaid", "markdown"];

/** What the picker shows for each format. */
export const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  svg: "SVG",
  mermaid: "Mermaid",
  markdown: "Markdown",
};

const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  mermaid: "text/vnd.mermaid",
  markdown: "text/markdown",
};

const EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  svg: "svg",
  mermaid: "mmd",
  markdown: "md",
};

export interface ExportOptions {
  /** Blank margin around the board, in world units. */
  padding?: number;
  /** Pixel multiplier for the raster formats. Defaults to 2. */
  scale?: number;
  background?: string;
}

/** The live canvas element, or null when the board is not mounted. */
export function canvasElement(): SVGSVGElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(CANVAS_SVG_ID) as unknown as SVGSVGElement | null;
}

/**
 * The world-space box that holds every drawn thing.
 *
 * Measured on the *live* group, because `getBBox` needs a laid-out element and
 * a detached clone has no layout. The group's own transform is excluded by
 * definition — `getBBox` reports the untransformed union of its children — so
 * this is the board's extent, whatever the viewport happens to be showing.
 */
function worldBox(svg: SVGSVGElement): DOMRect | null {
  const world = svg.querySelector<SVGGElement>(":scope > g");
  if (!world) return null;
  try {
    const box = world.getBBox();
    return box.width > 0 && box.height > 0 ? box : null;
  } catch {
    return null;
  }
}

/** Strip the live-only bits from a cloned subtree. */
function clean(node: Element): void {
  for (const child of Array.from(node.children)) {
    // Fingertip cuffs and the invisible ribbons that catch a tap on an edge:
    // present only to be touched, and never to be seen.
    if (child.getAttribute("fill") === "transparent" || child.getAttribute("stroke") === "transparent") {
      child.remove();
      continue;
    }
    child.removeAttribute("class");
    child.removeAttribute("style");
    clean(child);
  }
}

/**
 * Serialize the board as a standalone SVG document framing all of it.
 *
 * Returns null when there is no canvas or nothing has been drawn on it.
 */
export function serializeCanvas(opts: ExportOptions = {}): string | null {
  const svg = canvasElement();
  if (!svg) return null;
  const box = worldBox(svg);
  if (!box) return null;

  const padding = opts.padding ?? 48;
  const background = opts.background ?? BACKGROUND;
  const minX = Math.round(box.x - padding);
  const minY = Math.round(box.y - padding);
  const width = Math.round(box.width + padding * 2);
  const height = Math.round(box.height + padding * 2);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("id");
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
  clone.setAttribute("font-family", FONT_STACK);

  clean(clone);

  // The pan and zoom the designer is currently using are not part of the board.
  const world = clone.querySelector<SVGGElement>(":scope > g");
  world?.removeAttribute("transform");

  const backdrop = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  backdrop.setAttribute("x", String(minX));
  backdrop.setAttribute("y", String(minY));
  backdrop.setAttribute("width", String(width));
  backdrop.setAttribute("height", String(height));
  backdrop.setAttribute("fill", background);
  clone.insertBefore(backdrop, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

/** Paint an SVG document onto a canvas and hand back the encoded bitmap. */
function rasterize(svg: string, format: "png" | "jpeg", scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const size = svg.match(/width="(\d+)"\s+height="(\d+)"/);
    const width = size ? Number(size[1]) : 1200;
    const height = size ? Number(size[2]) : 800;

    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("this browser gave no 2d context to draw into"));
        return;
      }
      // JPEG has no transparency to fall back on, so the backdrop is painted
      // before the board rather than trusted to the SVG alone.
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("the canvas produced no image"))),
        MIME[format],
        format === "jpeg" ? 0.92 : undefined
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("the browser could not read the serialized board"));
    };
    img.src = url;
  });
}

export interface ExportSubject {
  /** The machine being drawn — its `settings.name` names the file. */
  definition: StateMachineDefinition;
  /** Absolute path of the project document, when the client knows it. */
  docPath?: string | null;
  /** The document's bare name, used when the full path is unknown. */
  fileName?: string | null;
}

/**
 * The download name: `[ep252--]<Machine>--<yyMMddHHmmss>.<ext>`.
 *
 * Built by the protocol so a browser download and a `smcx render --stamp` land
 * on the same shape of name. The episode prefix appears when the document sits
 * under a chronicle episode; the stamp means the second export of an afternoon
 * never overwrites the first.
 */
export function exportFileName(subject: ExportSubject, format: ExportFormat, at?: Date): string {
  return diagramFileName({
    doc: subject.docPath ?? subject.fileName ?? null,
    machine: subject.definition?.settings?.name ?? null,
    // A format outside the table is already impossible by type; falling back to
    // its own name keeps a caller that reached here from JS with a file called
    // something, rather than one called `.undefined`.
    format: EXTENSION[format] ?? String(format),
    at: at ?? new Date(),
  });
}

/** The mermaid source, alone or fenced for a markdown document. */
function mermaidBody(definition: StateMachineDefinition, fenced: boolean): string {
  const source = renderMermaid(definition);
  return fenced ? `\`\`\`mermaid\n${source}\n\`\`\`\n` : `${source}\n`;
}

/**
 * Export the board and hand it to the browser as a download.
 *
 * Throws with a sentence worth showing when there is nothing to draw or the
 * browser refuses to rasterize — the caller surfaces it on the toolbar.
 * Returns the name it wrote.
 */
export async function downloadCanvas(
  format: ExportFormat,
  subject: ExportSubject,
  opts: ExportOptions = {}
): Promise<string> {
  let blob: Blob;

  if (format === "mermaid" || format === "markdown") {
    blob = new Blob([mermaidBody(subject.definition, format === "markdown")], {
      type: `${MIME[format]};charset=utf-8`,
    });
  } else {
    const svg = serializeCanvas(opts);
    if (!svg) throw new Error("nothing on the board to export yet");
    blob =
      format === "svg"
        ? new Blob([svg], { type: `${MIME.svg};charset=utf-8` })
        : await rasterize(svg, format, opts.scale ?? 2);
  }

  const name = exportFileName(subject, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}
