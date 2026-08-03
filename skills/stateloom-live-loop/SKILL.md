---
name: stateloom-live-loop
description: Run the stateloom real-time design bridge so an agent and a human edit the same state-machine board at once. Use when starting the smcraft bridge hub, connecting the MCP server or smcx CLI to a live web canvas, running smcx watch or smcx presence, understanding rooms keyed by absolute document path, persist-then-emit durability, external-edit detection and mtime dedup, or diagnosing "○ no disk", "bridge unreachable", a canvas that will not animate, or a dropped emit warning.
---

# The live design loop

One `.smdf.json` file, several surfaces, all editing at once. The agent adds a state through
MCP; the human sees it bloom on the canvas half a second later. The human drags a box; the
agent's next `get_definition` has it.

```
        MCP (agent)          smcx (terminal)         web canvas (:4598)
             │                     │                        │
   writeDef()│           writeDef()│              PUT /api/file
             ▼                     ▼                        ▼
        ┌────────────────────────────────────────────────────────┐
        │        STATELOOM_PROJECT_FILE  (absolute path)         │
        │                  THE DURABLE TRUTH                     │
        └────────────────────────────────────────────────────────┘
             │ then, stamped with the new mtime, each emits
             └─────────────► hub :4599 ◄──────────────┘
                       sequencer · presence · differ
                       NEVER writes to disk
```

Two invariants explain nearly everything:

1. **Persist first, emit second.** Every mutating surface writes the file, *then* tells the
   hub. If the hub is down the change still lands — you lose the animation, never the work.
2. **The hub never writes disk.** It sequences, broadcasts, tracks presence, and watches the
   file for edits nobody announced. Kill it and the file-based loop still works.

---

## Step 1 — Start the hub

```bash
export STATELOOM_PROJECT_FILE="$(realpath -m ./statemachine.smdf.json)"
export STATELOOM_BRIDGE_PORT=4599
export STATELOOM_BRIDGE_HOST=127.0.0.1
export STATELOOM_BRIDGE_URL="http://127.0.0.1:4599"

smcraft-bridge                                  # env-driven, no flags
# or
smcx serve --port 4599 --host 127.0.0.1 --file "$STATELOOM_PROJECT_FILE"
```

**Verify:**

```bash
curl -sS "http://127.0.0.1:4599/socket.io/?EIO=4&transport=polling"
# → 0{"sid":"…","upgrades":["websocket"],"pingInterval":25000,…}
```

One hub is enough for many machines. Do not start a second one on another port because you
opened a second document — see rooms, below.

---

## Step 2 — Rooms are keyed by absolute document path

The hub serves **one room per `docId`**, and `docId` is the normalized absolute path of the
project file. Two peers meet only if their paths resolve to the same string.

This is why relative paths break the loop: `./statemachine.smdf.json` from the MCP process's
directory and `./statemachine.smdf.json` from the web server's directory are two different
rooms *and* two different files, with no error anywhere.

It is also what makes an agent able to move:

```
set_project_file { "path": "/srv/…/episode-103/diagrams/film-preprod.smdf.json" }
```

The MCP disconnects from the old room and joins the room for the new path. The reply tells you
both halves:

```
Active document: /srv/…/diagrams/film-preprod.smdf.json
Previous: /home/me/statemachine.smdf.json
no file yet — create_state_machine or load_definition will write it
bridge re-joining room '/srv/…/diagrams/film-preprod.smdf.json'
```

**Caveat, verified:** the web canvas binds its document per *server process* — `/api/file`
resolves the web app's own `STATELOOM_PROJECT_FILE`. Re-pointing the agent does **not**
re-point the browser. To move the canvas, restart the web server with the new env.

---

## Step 3 — Connect the peers

### The agent (MCP)

Register with `STATELOOM_BRIDGE_URL` set. Confirm from inside the session:

```
get_project_file
→ Active document: /abs/path.smdf.json
  machine 'OrderWorkflow' (6 states, 3 events)
  bridge: connected → http://127.0.0.1:4599
```

`bridge: not initialized` or `bridge not configured (STATELOOM_BRIDGE_URL unset)` means the
agent is editing offline. Its writes still persist; nobody watching will see them arrive.

### The terminal (`smcx`)

Every mutating command persists then emits, and says which happened:

```bash
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" add-state Green
```

```
+ state "Green" under "Root"
  · emitted def:patch → http://127.0.0.1:4599
```

Other endings, all non-fatal:

| Line | Means |
|---|---|
| `· bridge not set — persisted to <path> (disk only)` | No `--bridge` and no `STATELOOM_BRIDGE_URL` |
| `· bridge unreachable at <url> — persisted to disk only (…)` | Hub down or wrong port |

### The canvas (web, :4598)

The browser bundle reads `NEXT_PUBLIC_STATELOOM_BRIDGE_URL`, **inlined at build time**.
Setting it on a running server changes nothing — rebuild, then restart.

---

## Step 4 — Watch the loop live

### Terminal mirror

```bash
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" watch --as ascii
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" watch --as mermaid
```

`watch` joins the room as role `cli`, seeds itself from the join snapshot, then clears and
reprints on every change until Ctrl-C. It also tracks `runtime.enter` / `runtime.exit` events,
so a running machine's live state shows in the terminal.

Requires a bridge URL — without one it exits 1 with
`watch: no bridge URL — set --bridge or STATELOOM_BRIDGE_URL`.

### Who is in the room

```bash
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" presence
```

```
presence @ /workspace/…/statemachine.smdf.json — 3 peer(s):
  agent    mcp-agent
  web      designer
  cli      2HEUqusPJP4TFRQPAABN
```

Roles are `agent`, `cli`, `web`, `runtime`. Name a peer with `--name`:

```bash
smcx --name "mia-terminal" … presence
```

The MCP server presents as `mcp-agent` unless `STATELOOM_AGENT_NAME` says otherwise.

**Use `presence` as your first diagnostic.** It answers "are we in the same room?" in one line,
which is the question behind most live-loop confusion.

---

## Step 5 — Prove the whole loop in one command

With the hub up, the canvas open, and the agent registered:

```bash
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" add-state Proof
```

Expect, within a second: the node appears on the browser canvas with an enter animation; a
running `smcx watch` reprints with `Proof` in the tree; the agent's next `list_states` includes
it. Then clean up:

```bash
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" remove-state Proof
```

If the file changes but nothing animates, the hub link is broken, not the loop — the work is
safe, the sync is not.

---

## How the hub keeps one file honest

- **Sequencing.** The hub assigns a monotonic `seq` per room. A client that receives an
  out-of-order event asks for a full resync rather than drifting.
- **Self-write dedup.** Every emit carries the `mtime` of the file the sender just wrote. The
  hub keeps a small ring of recent `{mtime, hash}` pairs. When its own file watcher fires for
  a change already in the ring, it stays quiet — your write does not echo back at you.
- **External-edit detection.** When the watcher sees a change that is *not* in the ring —
  someone edited the JSON in an editor, or a standalone MCP wrote the same path — the hub
  diffs its in-memory definition against the file and broadcasts the difference as a granular
  patch. If the file is unparseable or the diff throws, it broadcasts the whole definition
  instead. Either way the surfaces converge.
- **Concurrent writers.** Disk is last-write-wins. The sequence gives ordering, not merging.
  Two peers editing the same state at the same second is still a race — narrate what you are
  about to change when a human is on the other end.

---

## Diagnosing `○ no disk`

The web toolbar shows one of four badges:

| Badge | Meaning |
|---|---|
| `⌁ synced` | The canvas and the file agree |
| `↻ remote changed` | The file moved under the canvas; it is re-hydrating |
| `⚠ disk error` | The bound path exists but could not be read or written |
| `○ no disk` | No file is bound — the canvas is editing thin air |

`○ no disk` is almost always **one relative path, two working directories**. The MCP server
and the web app each resolve `STATELOOM_PROJECT_FILE` against their own cwd; started from
different directories with a relative value, they bind different files and never meet.

Work it in this order:

```bash
# 1. What does the shell think?
echo "$STATELOOM_PROJECT_FILE"          # must start with /

# 2. Does the file exist and parse?
jq . "$STATELOOM_PROJECT_FILE" > /dev/null && echo "parses"

# 3. What does the agent think?  (MCP tool)
get_project_file                        # compare the path, character for character

# 4. What does the web process think?
#    Restart it with an explicit absolute value:
STATELOOM_PROJECT_FILE=/abs/path.smdf.json PORT=4598 npm run start

# 5. Are they in one room?
smcx --bridge "$STATELOOM_BRIDGE_URL" --doc "$STATELOOM_PROJECT_FILE" presence
```

The fix is always the same: **an absolute `STATELOOM_PROJECT_FILE` everywhere.** In a
repository checkout, `scripts/live-loop.sh` computes the absolute paths once, exports both the
`STATELOOM_*` and legacy `SMCRAFT_*` twins, and writes them to `.env.smcraft-live` so you can
read exactly what each process was handed.

---

## Other symptoms

| Symptom | Cause | Fix |
|---|---|---|
| MCP logs `dropped patch emit — bridge status=…; disk write succeeded, live canvas did not update. (warned once)` | The bridge client is not connected | Start the hub; restart the MCP so it re-joins |
| MCP logs `STATELOOM_BRIDGE_URL is not set — edits persist to disk but are NOT broadcast` | Registered without bridge env | Re-register with `--env STATELOOM_BRIDGE_URL=…` |
| `presence` shows only your CLI | Other peers are in a different room (different path) or not connected | Compare `get_project_file` against `echo $STATELOOM_PROJECT_FILE` |
| Canvas animates for the CLI but not the agent | Two different documents | `set_project_file` to the canvas's path |
| Hand-edited JSON does not reach the canvas | The hub is not watching that path | The watcher lives per room — make sure a peer has joined that `docId` |
| Everything works, nothing animates | Web bundle built without `NEXT_PUBLIC_STATELOOM_BRIDGE_URL` | Rebuild the web app, then restart it |
| Duplicate `agent mcp-agent` rows in `presence` | Several MCP processes joined over the session | Harmless; they clear as processes exit |

---

## Working well beside a human

- Mutate in small steps. `add_state` × 5 is five animations the human can follow;
  `load_definition` of the same five is one silent swap.
- Say what you are about to do before you do it. The human is reading the board, not the log.
- Before a large change, `get_definition` — you then hold the exact JSON to restore.
- Never re-point the document mid-conversation without saying so. `set_project_file` moves the
  agent's room silently as far as the canvas is concerned.
- A live session is a relation, not a resource. If the human is mid-thought on a state, leave
  it alone.
