# @miadi/stateloom-cli

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-cli)](https://www.npmjs.com/package/@miadi/stateloom-cli)

`smcx` — the stateloom design surface in the terminal: mutate a state machine document, watch it live, render it to an image, and see who else is in the room.

## Install

```bash
npm install -g @miadi/stateloom-cli
# or, without installing:
npx @miadi/stateloom-cli render --as svg
```

## What it is

A terminal client for the same `.smdf.json` document a browser canvas and an LLM agent are editing. Mutations are **durable-first**: `smcx` writes the file, then emits the change to the hub — so the document on disk is the truth, and the hub only sequences and rebroadcasts it. `smcx render` skips the hub entirely and draws straight from disk, which means it works with no server, no browser, and no agent running.

It is not the hub (that is `@miadi/stateloom`, bootable here via `smcx serve`) and not the engine (`@miadi/stateloom-engine` runs the machines this designs).

## Usage

```bash
export STATELOOM_PROJECT_FILE=/abs/path/to/statemachine.smdf.json
export STATELOOM_BRIDGE_URL=http://127.0.0.1:4599

smcx serve --port 4599                       # boot the hub and keep it alive

smcx add-state Shipped --parent Root --kind final
smcx add-event ship --desc "carrier picked up"
smcx add-transition Approved ship --to Shipped --when paymentCleared
smcx remove-state Draft
smcx load ./another.smdf.json                # replace the whole definition

smcx watch --as ascii                        # stream the live doc until Ctrl-C
smcx presence                                # print the peer roster and exit
smcx open --web http://localhost:4598        # open the web designer
```

### Global options

| Option | Default | Meaning |
|---|---|---|
| `--bridge <url>` | `STATELOOM_BRIDGE_URL` | Hub socket.io URL |
| `--doc <path>` | `STATELOOM_PROJECT_FILE` | The `.smdf.json` document (its absolute path is the room key) |
| `--name <label>` | — | Presence label for this client |

The legacy `SMCRAFT_*` twin of each environment variable is still honored.

### Rendering

```bash
smcx render --as png --scale 2 --open   # → /abs/path/to/statemachine.png, opened
smcx render --as svg                    # needs no rasterizer at all
smcx render --as mermaid --out -        # to stdout, for a README
smcx render --as ascii                  # → .txt
smcx render --as png --stamp            # → ep252--OrderWorkflow--260803093500.png
```

| Option | Meaning |
|---|---|
| `--as svg\|png\|mermaid\|ascii` | Output format (default `svg`) |
| `--out <path\|->` | Explicit destination; `-` writes text formats to stdout |
| `--scale <n>` | Pixel multiplier for `png` (default 2) |
| `--theme dark\|light` | Board theme (default `dark`) |
| `--title <text>` | Caption above the board; an empty string draws none |
| `--stamp` | Name the file `[ep252--]<Machine>--<yyMMddHHmmss>.<ext>` instead of overwriting |
| `--open` | Open the result in the platform viewer |

`png` goes through whichever rasterizer the host has — librsvg, Inkscape, ImageMagick, or headless Chrome, tried in that order. `svg` needs none. The command prints the absolute path it wrote.

## Programmatic renderers

The renderers are reachable without the command shell, so another process can draw the same picture. Nothing behind this entry point reads argv or writes to stdout:

```ts
import { renderDiagramToFile, defaultOutputPath, renderMermaid } from "@miadi/stateloom-cli/render";

const out = defaultOutputPath(doc, "png");
const result = await renderDiagramToFile(def, { format: "png", doc, scale: 2, theme: "dark" });
// { path, format, bytes, backend, width, height }

const mmd = renderMermaid(def);
```

Also exported there: `renderAscii`, `renderSvg`, `svgToPng`, `svgSize`, `renderDiagramText`, `stampedOutputPath`, `DIAGRAM_FORMATS`.

## Part of the stateloom stack

| Package | Role |
|---|---|
| [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine) | State machine engine: parser, validator, interpreter, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | Patch ops, diff/apply, layout, renderers — zero runtime deps |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | socket.io hub holding the live document |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | Framework-agnostic client for the hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React binding over the client |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — terminal design surface and renderers — **this package** |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | MCP server so LLM agents can design machines |

## License

MIT © Guillaume Isabelle
