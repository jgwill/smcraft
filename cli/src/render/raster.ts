/**
 * SVG → PNG, through whichever rasterizer this machine actually has.
 *
 * There is no good reason to make a diagram export depend on a native module
 * that fails to build, so nothing here is a hard dependency. The backends are
 * tried in order of fidelity and speed — in-process `sharp` if some sibling
 * package installed it, then librsvg, Inkscape, ImageMagick, and headless
 * Chrome as the last resort. The first one that writes a non-empty file wins,
 * and if none is present the caller is told what to install rather than handed
 * a silent failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface RasterOptions {
  /** Pixel multiplier over the SVG's own width/height. 2 gives a retina export. */
  scale?: number;
}

export interface RasterResult {
  /** Which backend produced the file — reported so a surprising look is traceable. */
  backend: string;
  width: number;
  height: number;
}

/** The `width`/`height` an SVG document declares, falling back to its viewBox. */
export function svgSize(svg: string): { width: number; height: number } {
  const attr = (name: string): number => {
    const m = svg.match(new RegExp(`\\b${name}\\s*=\\s*"([0-9.]+)`));
    return m ? Number(m[1]) : 0;
  };
  const width = attr("width");
  const height = attr("height");
  if (width > 0 && height > 0) return { width, height };

  const box = svg.match(/viewBox\s*=\s*"([-0-9.\s]+)"/);
  if (box) {
    const parts = box[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  return { width: 1200, height: 800 };
}

/** True when `path` exists and holds something. */
const wrote = (path: string): boolean => existsSync(path) && statSync(path).size > 0;

/** Run a converter; a missing binary is a miss, not a crash. */
function run(bin: string, args: string[]): boolean {
  const r = spawnSync(bin, args, { stdio: "ignore", timeout: 120_000 });
  return !r.error && r.status === 0;
}

type SharpModule = {
  default: (
    input: Buffer,
    opts?: unknown
  ) => {
    resize: (w: number, h: number) => { png: () => { toFile: (p: string) => Promise<unknown> } };
  };
};

async function viaSharp(
  svgPath: string,
  out: string,
  width: number,
  height: number
): Promise<boolean> {
  try {
    // Named through a variable: `sharp` is an optional peer nobody declares, so
    // it must not become a static import the type-checker or a bundler chases.
    const specifier = "sharp";
    const mod = (await import(specifier)) as SharpModule;
    const sharp = mod.default;
    await sharp(readFileSync(svgPath), { density: 96 })
      .resize(Math.round(width), Math.round(height))
      .png()
      .toFile(out);
    return wrote(out);
  } catch {
    return false;
  }
}

/**
 * Rasterize `svg` to a PNG at `out`. Throws only when the machine has no
 * rasterizer at all — the message names the ones it looked for.
 */
export async function svgToPng(
  svg: string,
  out: string,
  opts: RasterOptions = {}
): Promise<RasterResult> {
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 2;
  const base = svgSize(svg);
  const width = Math.max(1, Math.round(base.width * scale));
  const height = Math.max(1, Math.round(base.height * scale));

  const dir = mkdtempSync(join(tmpdir(), "stateloom-render-"));
  const svgPath = join(dir, "diagram.svg");
  writeFileSync(svgPath, svg, "utf8");

  try {
    if (await viaSharp(svgPath, out, width, height)) {
      return { backend: "sharp", width, height };
    }

    const attempts: [string, () => boolean][] = [
      [
        "rsvg-convert",
        () => run("rsvg-convert", ["-w", String(width), "-h", String(height), "-o", out, svgPath]),
      ],
      [
        "inkscape",
        () =>
          run("inkscape", [
            "--export-type=png",
            `--export-filename=${out}`,
            `--export-width=${width}`,
            `--export-height=${height}`,
            svgPath,
          ]),
      ],
      [
        "magick",
        () =>
          run("magick", [
            "-density",
            String(Math.round(96 * scale)),
            "-background",
            "none",
            svgPath,
            out,
          ]),
      ],
      [
        "convert",
        () =>
          run("convert", [
            "-density",
            String(Math.round(96 * scale)),
            "-background",
            "none",
            svgPath,
            out,
          ]),
      ],
      ...["google-chrome", "chromium", "chromium-browser"].map(
        (bin): [string, () => boolean] => [
          bin,
          () =>
            run(bin, [
              "--headless",
              "--disable-gpu",
              "--no-sandbox",
              `--screenshot=${out}`,
              `--window-size=${width},${height}`,
              `--force-device-scale-factor=1`,
              `file://${svgPath}`,
            ]),
        ]
      ),
    ];

    for (const [backend, attempt] of attempts) {
      if (attempt() && wrote(out)) return { backend, width, height };
    }

    throw new Error(
      "No SVG rasterizer found. Install one of: librsvg (rsvg-convert), Inkscape, " +
        "ImageMagick (magick/convert), or Chrome/Chromium — or render `--as svg`, " +
        "which needs nothing."
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
