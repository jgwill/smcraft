/**
 * `smcx render` — draw the project file as a picture.
 *
 * Reads the durable document straight off disk rather than joining the bridge:
 * the file is the truth every other channel persists to, so a render works with
 * no hub running, no browser open, and no agent connected.
 *
 * Text formats can go to stdout (`--out -`) so the command composes in a pipe.
 * Everything else lands on disk and the absolute path is printed on its own
 * line — that line is what an agent hands to whatever opens a file.
 */
import { spawn } from "node:child_process";
import { readDef } from "../docio.js";
import {
  DIAGRAM_FORMATS,
  defaultOutputPath,
  renderDiagramText,
  renderDiagramToFile,
  type DiagramFormat,
} from "../render/index.js";
import type { SvgTheme } from "../render/index.js";

export interface RenderOpts {
  doc: string;
  as?: string;
  out?: string;
  scale?: number;
  theme?: string;
  title?: string;
  open?: boolean;
  stamp?: boolean;
}

function openerFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  return "xdg-open";
}

/** Hand `path` to the platform viewer. Never fatal — a headless box has none. */
function openFile(path: string): void {
  const opener = openerFor(process.platform);
  try {
    const child = spawn(opener, [path], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    });
    child.on("error", () => {
      console.error(`render: could not launch "${opener}" — open ${path} yourself`);
    });
    child.unref();
  } catch {
    console.error(`render: no opener available — open ${path} yourself`);
  }
}

export async function renderCommand(opts: RenderOpts): Promise<void> {
  const format = (opts.as ?? "svg") as DiagramFormat;
  if (!DIAGRAM_FORMATS.includes(format)) {
    console.error(`render: unknown format "${opts.as}" — use ${DIAGRAM_FORMATS.join(" | ")}`);
    process.exitCode = 1;
    return;
  }

  const def = readDef(opts.doc);
  if (!def) {
    console.error(`render: no readable definition at ${opts.doc}`);
    process.exitCode = 1;
    return;
  }

  const theme = (opts.theme === "light" ? "light" : "dark") as SvgTheme;
  const title = opts.title === "" ? (false as const) : opts.title;

  if (opts.out === "-") {
    const text = renderDiagramText(def, { format, theme, title });
    if (text === null) {
      console.error("render: png cannot be written to stdout — pass --out <file>");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(text + "\n");
    return;
  }

  try {
    const result = await renderDiagramToFile(def, {
      format,
      out: opts.out,
      doc: opts.doc,
      scale: opts.scale,
      theme,
      title,
      stamp: opts.stamp,
    });
    const size =
      result.width && result.height ? ` ${result.width}×${result.height}` : "";
    const how = result.backend ? ` via ${result.backend}` : "";
    console.error(`${result.format}${size} · ${result.bytes} bytes${how}`);
    console.log(result.path);
    if (opts.open) openFile(result.path);
  } catch (e) {
    console.error(`render: ${e instanceof Error ? e.message : String(e)}`);
    console.error(`render: an SVG needs no rasterizer — ${defaultOutputPath(opts.doc, "svg")}`);
    process.exitCode = 1;
  }
}
