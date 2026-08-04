---
name: stateloom-setup
description: Install and wire the whole stateloom / smcraft state-machine system from nothing. Use when setting up stateloom or smcraft from scratch, installing the @miadi/stateloom npm packages or the smcraft PyPI package, registering the stateloom MCP server with Claude Code or another MCP client, choosing or creating a .smdf.json project document, starting the design bridge hub on port 4599, wiring the web designer on port 4598, setting STATELOOM_PROJECT_FILE / STATELOOM_BRIDGE_URL, or verifying that the hub, the MCP server and the canvas are all live and pointing at the same file.
---

# Standing up stateloom

Stateloom is one `.smdf.json` document on disk, surrounded by surfaces that all read and write
it: an MCP server an agent talks to, a socket.io hub that broadcasts each change, a CLI, and a
web canvas. Setup means making every surface agree on **one absolute path** and **one hub URL**.

```
                  @miadi/stateloom (hub, :4599)
                   sequencer + broadcaster
                   NEVER writes disk
        ┌───────────────┬───────────┬───────────────┐
        │               │           │               │
   MCP server        smcx CLI    web designer    forgewright
  (agent, stdio)                   (:4598)        (runtime)
        │               │           │               │
        └───────────────┴─────┬─────┴───────────────┘
                              ▼
                  STATELOOM_PROJECT_FILE
                    <machine>.smdf.json
                     THE DURABLE TRUTH
```

Work the steps in order. Each ends with a check — do not continue past a failed check.

---

## Step 0 — Preconditions

```bash
node -v      # 20 or newer (the web designer is Next.js 16 / React 19)
npm -v
python3 -V   # 3.10 or newer, only if you want Python codegen
```

Decide now which of the two modes you are in, because every later command differs:

- **Mode A — consumer.** You want to use stateloom in your own project. Install from npm/PyPI.
- **Mode B — contributor.** You have the `smcraft` repository checked out and want to run the
  surfaces from source.

---

## Step 1 — Install the packages

### Mode A — from the registries

```bash
# CLI (bin: smcx) + hub (bin: smcraft-bridge) + MCP server (bins: stateloom-mcp, smcraft-mcp)
npm install -g @miadi/stateloom-cli @miadi/stateloom @miadi/stateloom-mcp

# Python engine + code generator (bin: smcg) — only for Python codegen
pip install smcraft

# TypeScript runtime — only if generated TS code will run in your project
npm install @miadi/stateloom-engine
```

The full family, and what each is for:

| Package | Registry | Gives you |
|---|---|---|
| `@miadi/stateloom-protocol` | npm | Pure contract: SMDF types, `PatchOp`, `diffDefinition`, `applyPatchOps`, `autoLayout`, `diagramFileName`, `envAlias`. Zero dependencies. |
| `@miadi/stateloom-client` | npm | `createBridgeClient` — a socket.io-client wrapper for any peer. |
| `@miadi/stateloom` | npm | The socket.io hub. Bin `smcraft-bridge`, API `startBridge()`. |
| `@miadi/stateloom-react` | npm | `useSmcraftBridge` hook for React 19 canvases. |
| `@miadi/stateloom-cli` | npm | Bin `smcx` + the renderers (`@miadi/stateloom-cli/render`). |
| `@miadi/stateloom-mcp` | npm | The MCP server. Bins `stateloom-mcp` and legacy `smcraft-mcp`. |
| `@miadi/stateloom-engine` | npm | The TypeScript engine: runtime, parser, `Machine` interpreter, codegen. (Renamed from `smcraft`, which is deprecated on npm.) |
| `smcraft` | PyPI | The Python engine + the `smcg` code generator CLI. |

**Check:**

```bash
smcx --version && smcx --help | head -5
smcg --help | head -3          # only if you installed the Python package
```

### Mode B — from the repository

Build in dependency order — the packages link to each other with `file:` paths:

```bash
cd /path/to/smcraft
for p in bridge-protocol bridge-client bridge bridge-react cli mcp; do
  (cd "$p" && npm install && npm run build) || { echo "FAILED: $p"; break; }
done
(cd py && pip install -e .)     # gives you smcg
(cd web && npm install)         # the designer, if you want the canvas
```

**Check:** `ls bridge/dist/bin.js cli/dist/index.js mcp/dist/server.js` lists three files.

---

## Step 2 — Choose the project document

This is the decision everything else hangs off. It must be an **absolute path** ending in
`.json` (convention: `.smdf.json`).

```bash
export STATELOOM_PROJECT_FILE="$(realpath -m ./statemachine.smdf.json)"
echo "$STATELOOM_PROJECT_FILE"
```

The file does not have to exist yet — `create_state_machine`, `load_definition` or
`smcx add-state` will write it. If you want it to exist now:

```bash
cat > "$STATELOOM_PROJECT_FILE" <<'JSON'
{
  "stateMachine": {
    "settings": { "namespace": "MyApp", "name": "OrderWorkflow", "asynchronous": false },
    "events": [ { "name": "Internal", "events": [] } ],
    "state": { "name": "Root", "states": [] }
  }
}
JSON
```

Conventions worth honoring:

- A machine belonging to a miadi-chronicle episode lives at
  `<episode>/diagrams/<name>.smdf.json` — the render surfaces read the episode out of that
  path and prefix exports with `ep103--`.
- A machine belonging to a project lives beside its code, in version control.

**Check:** `python3 -c "import json,os;json.load(open(os.environ['STATELOOM_PROJECT_FILE']))"`
exits 0 (or the file does not exist yet, which is also fine).

---

## Step 3 — The environment contract

`STATELOOM_*` is read first; the legacy `SMCRAFT_*` twin is honored as a fallback by every
package (`envAlias` in `@miadi/stateloom-protocol`). Export **both twins** if any older
registration is still in play.

| Variable | Default | Read by |
|---|---|---|
| `STATELOOM_PROJECT_FILE` | `./statemachine.smdf.json` | MCP, CLI, hub, web server-side. **Make it absolute.** |
| `STATELOOM_BRIDGE_HOST` | `127.0.0.1` | hub |
| `STATELOOM_BRIDGE_PORT` | `4599` | hub |
| `STATELOOM_BRIDGE_URL` | `http://$HOST:$PORT` | MCP, CLI |
| `STATELOOM_BRIDGE_TOKEN` | *(unset)* | hub + clients — optional handshake auth |
| `STATELOOM_WEB_PORT` | `4598` | the web designer's `PORT` |
| `NEXT_PUBLIC_STATELOOM_BRIDGE_URL` | *(unset)* | the web **browser** bundle — inlined at build time |

**4598 (canvas) and 4599 (hub) are the pair.** Keep them together.

Write them once so every process reads the same values:

```bash
export STATELOOM_PROJECT_FILE="$(realpath -m ./statemachine.smdf.json)"
export STATELOOM_BRIDGE_HOST=127.0.0.1
export STATELOOM_BRIDGE_PORT=4599
export STATELOOM_BRIDGE_URL="http://${STATELOOM_BRIDGE_HOST}:${STATELOOM_BRIDGE_PORT}"
export STATELOOM_WEB_PORT=4598
export NEXT_PUBLIC_STATELOOM_BRIDGE_URL="$STATELOOM_BRIDGE_URL"

# legacy twins, so an older MCP registration keeps working
export SMCRAFT_PROJECT_FILE="$STATELOOM_PROJECT_FILE"
export SMCRAFT_BRIDGE_URL="$STATELOOM_BRIDGE_URL"
export NEXT_PUBLIC_SMCRAFT_BRIDGE_URL="$STATELOOM_BRIDGE_URL"
```

In **Mode B** the repository does this for you and records the result:

```bash
scripts/live-loop.sh env        # prints eval-able exports, writes .env.smcraft-live
eval "$(scripts/live-loop.sh env)"
cat .env.smcraft-live           # inspect what every process will see
```

**Check:** `echo "$STATELOOM_PROJECT_FILE"` starts with `/`. If it does not, stop and fix it —
this is the single most common cause of a broken loop (see Step 7).

---

## Step 4 — Start the hub

The hub is a pure sequencer and broadcaster. It never writes to disk; each client persists
through its own channel and then emits.

```bash
# Mode A
smcraft-bridge                       # reads STATELOOM_BRIDGE_PORT / _HOST / _PROJECT_FILE

# either mode, flag-driven
smcx serve --port 4599 --host 127.0.0.1 --file "$STATELOOM_PROJECT_FILE"

# Mode B, from source
node bridge/dist/bin.js              # env-driven
scripts/live-loop.sh hub             # env-driven, absolute paths precomputed
```

`smcraft-bridge` takes **no command-line flags** — it is configured entirely by environment.
Use `smcx serve` when you want flags.

Run it in its own terminal or under a process manager; it stays in the foreground until
SIGINT.

**Check:**

```bash
curl -sS "http://127.0.0.1:4599/socket.io/?EIO=4&transport=polling"
```

prints a handshake beginning `0{"sid":"…","upgrades":["websocket"],…}`. Anything else — empty
output, connection refused — means the hub is not up.

---

## Step 5 — Register the MCP server

The MCP server is a stdio process. It reads `STATELOOM_PROJECT_FILE` at boot and, when
`STATELOOM_BRIDGE_URL` is set, mirrors every mutation to the hub so a live canvas animates.

### Claude Code

```bash
claude mcp add stateloom \
  --env STATELOOM_PROJECT_FILE="$STATELOOM_PROJECT_FILE" \
  --env STATELOOM_BRIDGE_URL="$STATELOOM_BRIDGE_URL" \
  -- npx -y @miadi/stateloom-mcp
```

Mode B, from source:

```bash
scripts/live-loop.sh mcp-line       # prints the exact registration line for this checkout
```

### JSON config (any MCP client)

`mcp-config.example.json` ships beside this skill. Copy it, replace both absolute paths:

```json
{
  "mcpServers": {
    "stateloom": {
      "command": "npx",
      "args": ["-y", "@miadi/stateloom-mcp"],
      "env": {
        "STATELOOM_PROJECT_FILE": "/absolute/path/to/statemachine.smdf.json",
        "STATELOOM_BRIDGE_URL": "http://127.0.0.1:4599"
      }
    }
  }
}
```

**Check:** start a session with the server registered and call `get_project_file`. It reports
three lines:

```
Active document: /absolute/path/to/statemachine.smdf.json
machine 'OrderWorkflow' (1 states, 0 events)     ← or "file does not exist yet"
bridge: connected → http://127.0.0.1:4599
```

If the third line says `bridge not configured (STATELOOM_BRIDGE_URL unset)`, the env did not
reach the MCP process — edits will persist to disk but no canvas will update.

---

## Step 6 — Start the web designer

The designer is a Next.js app served on `STATELOOM_WEB_PORT` (4598). Its browser bundle reads
`NEXT_PUBLIC_STATELOOM_BRIDGE_URL`, and **`NEXT_PUBLIC_*` is inlined at build time** — a
running server cannot be re-pointed by exporting a new value.

Mode B, from the repository:

```bash
scripts/live-loop.sh web-build      # builds with the bridge URL inlined
scripts/live-loop.sh web            # serves on $STATELOOM_WEB_PORT

# or, for development
cd web && PORT=4598 npm run dev
```

Open it:

```bash
smcx open
```

`smcx open` defaults to `http://localhost:$STATELOOM_WEB_PORT`, falling back to 4598 — the
designer's own port, so with the env exported there is nothing to pass. Override with
`--web <url>` when the canvas is somewhere else.

**Check:** the toolbar shows your file name and a green `⌁ synced`. `○ no disk` means the web
process resolved a different path than the MCP did — go to Step 7.

---

## Step 7 — Verification checklist

Run all six. Every one must pass before you call the loop live.

| # | Command | Passing result |
|---|---|---|
| 1 | `echo "$STATELOOM_PROJECT_FILE"` | An absolute path ending `.smdf.json` |
| 2 | `curl -sS "http://127.0.0.1:4599/socket.io/?EIO=4&transport=polling"` | `0{"sid":…}` handshake |
| 3 | MCP `get_project_file` | Same absolute path as #1, and `bridge: connected` |
| 4 | `smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" presence` | Lists peers, including `agent mcp-agent` and the `web` role |
| 5 | `smcx --doc "$STATELOOM_PROJECT_FILE" render --as ascii --out -` | Prints the state tree to stdout |
| 6 | Web toolbar | Shows the file name and `⌁ synced` |

A full end-to-end proof — drive the canvas from the terminal and watch the node bloom in the
browser:

```bash
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" add-state Green
```

Expected stdout:

```
+ state "Green" under "Root"
  · emitted def:patch → http://127.0.0.1:4599
```

If it prints `· bridge not set` or `· bridge unreachable …` the state still reached disk — the
mutation is never lost — but the live surfaces did not hear it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Web toolbar reads `○ no disk` | The web process and the MCP process resolved a **relative** `STATELOOM_PROJECT_FILE` against different working directories | Export an absolute path everywhere; restart both. In Mode B use `scripts/live-loop.sh`, which computes absolute paths once. |
| MCP logs `STATELOOM_BRIDGE_URL is not set — edits persist to disk but are NOT broadcast` | The MCP registration has no bridge env | Re-register with `--env STATELOOM_BRIDGE_URL=…` |
| `smcx` prints `· bridge unreachable at …` | Hub not running, or wrong port | Start the hub (Step 4); confirm with the curl check |
| Canvas does not animate but the file changes on disk | Browser bundle built without `NEXT_PUBLIC_STATELOOM_BRIDGE_URL` | Rebuild the web app with the variable set, then restart it |
| MCP `set_project_file` errors "must be a .json document" | Path does not end in `.json` | Use `.smdf.json` |
| Port 4599 already in use | Another hub is live | Reuse it — a hub serves one room per document, so several documents share one hub |

---

## What the pieces are, once it runs

- **The file is the truth.** Every surface persists to it first, then emits. Kill the hub and
  every mutation still lands.
- **The hub is a nervous system, not a database.** It sequences and broadcasts; it holds no
  authority the file does not already have.
- **Rooms are keyed by absolute document path.** One hub serves many machines. This is also
  why `set_project_file` can re-point an agent mid-session (see `stateloom-live-loop`).
