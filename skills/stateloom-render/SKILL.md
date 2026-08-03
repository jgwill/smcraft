---
name: stateloom-render
description: Draw a stateloom / smcraft state machine as a picture from the CLI, the MCP server or the web designer. Use when rendering a .smdf.json to PNG, SVG, Mermaid or ASCII, calling smcx render or the render_diagram MCP tool, exporting a diagram for a README or a chronicle episode, choosing --stamp export naming, picking a theme or scale, or fixing "No SVG rasterizer found" and PNG rasterization failures.
---

# Rendering the machine

Three surfaces draw the same board, so a machine can be looked at from wherever the work is
happening. All three read the definition, lay it out with the same `autoLayout` that sits
behind ⤢ Arrange in the designer, and agree on where the boxes sit.

| Surface | Reach for it when |
|---|---|
| `smcx render` (CLI) | Scripts, CI, a README, a terminal. Reads the file straight off disk — no hub, no browser, no agent needed. |
| `render_diagram` (MCP) | An agent needs to **see** what it just designed. PNG comes back inside the tool result. |
| Web designer (:4598) | A human wants the board **as arranged**, hand-dragged boxes included. |

---

## The four formats

| Format | Extension | Needs | Good for |
|---|---|---|---|
| `svg` | `.svg` | nothing | Anywhere. Scales, diffs as text, always works. **The safe default.** |
| `png` | `.png` | a rasterizer on the host | Chat, tickets, slides, inline agent viewing |
| `mermaid` | `.mmd` | nothing | READMEs, GitHub, anything that renders ```mermaid fences |
| `ascii` | `.txt` | nothing | Terminals, logs, a quick structural check |

`mermaid` and `ascii` are text and can go straight to stdout. `png` cannot.

---

## CLI — `smcx render`

```
smcx [--doc <path>] render [options]

  --as <format>   svg | png | mermaid | ascii     (default: svg)
  --out <path>    output file, or '-' for stdout (text formats only)
  --scale <n>     pixel multiplier for png        (default: 2)
  --theme <t>     dark | light                    (default: dark)
  --title <text>  caption above the board; an empty string draws none
  --stamp         name the file [ep252--]<Machine>--<yyMMddHHmmss>.<ext>
  --open          hand the result to the platform viewer
```

```bash
# a picture, next to the document
smcx --doc /abs/path/machine.smdf.json render --as png --scale 2 --open

# an SVG, which needs no rasterizer at all
smcx --doc /abs/path/machine.smdf.json render --as svg

# mermaid straight into a README
smcx --doc /abs/path/machine.smdf.json render --as mermaid --out - >> README.md

# a light-themed board with a caption, kept as a dated record
smcx --doc /abs/path/machine.smdf.json render --as png --theme light \
     --title "Order workflow — v2" --stamp
```

### Reading the output

Two streams, deliberately separated:

```
png 1672×964 · 74987 bytes via inkscape      ← stderr: what happened
/abs/path/machine.png                        ← stdout: where it landed
```

stdout is **only** the absolute path, so it pipes:

```bash
open "$(smcx --doc /abs/path/machine.smdf.json render --as png)"
```

For a non-raster format the stderr line has no dimensions: `svg · 7665 bytes`.

### Where the file lands

- With `--out <path>`: exactly there.
- Without `--out`: beside the document, its `.smdf.json` tail replaced by the format's
  extension — `film-preprod.smdf.json` → `film-preprod.png`. The next render **overwrites** it.
- With `--stamp`: a dated name in the document's directory, so renders pile up as a record
  instead of replacing each other.

### Text to stdout

`--out -` works for `mermaid`, `ascii` and `svg`. Asking for `png` on stdout fails cleanly:

```
render: png cannot be written to stdout — pass --out <file>
```

---

## MCP — `render_diagram`

```
render_diagram {
  "format": "png",      // png | svg | mermaid | ascii   (default: png)
  "path":   "…",        // explicit output path; otherwise beside the document
  "scale":  2,          // png only
  "theme":  "dark",     // dark | light
  "stamp":  false,      // keep every render instead of overwriting one file
  "open":   false       // hand it to the desktop viewer, when the host has one
}
```

What comes back depends on the format:

| Format | Tool result |
|---|---|
| `png` ≤ 1.5 MB | The note **plus the image inline** — the agent can look at what it designed |
| `png` > 1.5 MB | The note only; open the path yourself |
| `mermaid`, `ascii` | The note plus the rendered text |
| `svg` | The note only |

The note reads:

```
Rendered 'OrderWorkflow' → /abs/path/machine.png (74987 bytes, 1672×964, drawn by inkscape)
```

Note the default differs from the CLI: **MCP defaults to `png`** (an agent usually wants to
see), **`smcx` defaults to `svg`** (a terminal usually wants a file that always works).

When rasterization fails the tool returns an error result that tells you the way out:

```
render_diagram (png) failed: No SVG rasterizer found. …
An SVG needs no rasterizer — retry with format "svg" (it would land at /abs/path/machine.svg).
```

Do exactly that: retry with `"format": "svg"`.

---

## Web designer

The format picker beside 📥 exports **png, jpeg, svg, mermaid, markdown**.

- **png / jpeg / svg** take the canvas *as it stands* — hand-dragged boxes included. This is
  the only surface that can preserve manual placement.
- **mermaid (`.mmd`) / markdown (`.md`)** come from the definition, not the canvas: mermaid
  describes a graph and carries no placement. The markdown export is the same graph inside a
  ```` ```mermaid ```` fence, ready to paste into a document.

Browser downloads are **always** stamped — see naming, below.

---

## Export naming

A browser download always, and `--stamp` / `stamp: true` on demand, produce:

```
[ep252--]<Machine>--<yyMMddHHmmss>.<ext>

ep252--InteractiveProduction--260730175243.png
└ episode  └ machine            └ yyMMddHHmmss
```

- **Episode prefix** appears only when the document actually lives under a chronicle episode
  (`…/2026-07-19-episode-252-…/diagrams/<name>.smdf.json`, or a path carrying `ep103`). A
  machine outside the chronicle simply has no prefix to carry.
- **Machine name** is `settings.name`, slugged; it falls back to the document's file name, then
  to `statemachine`.
- **Stamp to the second**, because exporting a PNG and then an SVG of the same board happens
  inside one minute, and two names differing only by extension read as one file.

Implemented once, in `bridge-protocol/src/exportName.ts`, so CLI, MCP and browser name files
alike.

Use `--stamp` when the render is a record — a chronicle episode, a review, a handoff. Leave it
off when the render is a build artefact that should have one predictable path.

---

## PNG rasterization

`svg` never needs any of this. `png` is produced by converting an SVG with whichever backend
the host has, tried in this order — the first that writes a non-empty file wins:

| Order | Backend | Notes |
|---|---|---|
| 1 | `sharp` | In-process, only if some sibling package happens to have installed it. Never a declared dependency. |
| 2 | `rsvg-convert` | librsvg. Fast, faithful, the usual winner. |
| 3 | `inkscape` | Excellent fidelity, slower to start. |
| 4 | `magick` then `convert` | ImageMagick. Rasterizes at `96 × scale` DPI. |
| 5 | `google-chrome`, `chromium`, `chromium-browser` | Headless screenshot. Last resort. |

The backend that drew the file is always reported, so a surprising look is traceable.

When none is present:

```
No SVG rasterizer found. Install one of: librsvg (rsvg-convert), Inkscape,
ImageMagick (magick/convert), or Chrome/Chromium — or render `--as svg`, which needs nothing.
```

Two ways forward:

```bash
# render SVG instead — nothing to install
smcx --doc /abs/path/machine.smdf.json render --as svg

# or install a rasterizer
sudo apt-get install -y librsvg2-bin      # Debian / Ubuntu
brew install librsvg                      # macOS
```

`--scale` multiplies the SVG's own dimensions; `2` gives a retina-density export and is the
default. Raise it for print, lower it for a quick look.

---

## Choosing a surface

| You want | Use |
|---|---|
| To see it, mid-conversation, as an agent | MCP `render_diagram` with `format: "png"` |
| A file for a README | `smcx render --as mermaid --out -` |
| A file that works on any host, guaranteed | `smcx render --as svg` |
| A dated record inside a chronicle episode | `--stamp` (CLI) or `stamp: true` (MCP) |
| The board exactly as a human arranged it | The web designer's 📥 picker |
| A structural glance with no files at all | `smcx render --as ascii --out -` |

---

## Verify a render succeeded

```bash
OUT="$(smcx --doc "$STATELOOM_PROJECT_FILE" render --as png --scale 2)"
test -s "$OUT" && echo "rendered: $OUT" || echo "render produced nothing"
```

`smcx render` exits non-zero on an unknown format, an unreadable definition, or a failed
rasterization — check the exit code in scripts rather than parsing the message.
