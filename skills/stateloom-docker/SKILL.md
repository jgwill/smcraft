---
name: stateloom-docker
description: Run the entire stateloom loom — hub, visual canvas, MCP server and CLI — as containers on one port. Use when installing stateloom with Docker instead of npm, running `stateloom docker up`, using the jgwill/stateloom image or docker-compose.yml, giving a human a board to open without installing Node on their machine, choosing a web port other than 4598, registering the containerised MCP server over HTTP with a bearer token, mounting a documents directory, switching between diagrams in a container (GET /api/docs, the ⇄ switcher, why a host path is refused), setting STATELOOM_CANVAS_URL so the MCP's canvas links name the published port, or diagnosing a containerised loom whose canvas loads but never syncs.
---

# The loom in containers

One image, `jgwill/stateloom`. Four processes inside it. **One port.**

```
                    docker
   ┌──────────────────────────────────────────────┐
   │  gateway :8080  ← the only published port    │
   │     │                                        │
   │     ├── /socket.io/*  →  hub    :4599        │
   │     ├── /mcp          →  mcp    :4600        │
   │     └── everything    →  canvas :4598        │
   └──────────────────────────────────────────────┘
                          │
                    /data  (your .smdf.json documents)
```

The gateway is the whole reason this is simple. The canvas is told its bridge is `"/"` —
**the same origin as the page** — so the browser's socket follows the human wherever they
came from: `localhost`, a LAN address, a tailnet name, a TLS reverse proxy. Nothing has to
be configured to match the network, because nothing names the network.

Two ways in. Both end at the same four processes.

> ### ⚠ One loom per directory
>
> **Do not run a host-native loom and a containerised loom over the same documents
> directory.** The hub keys its rooms by normalized absolute path, and the two see
> different paths for one file — a host-native MCP says
> `/b/trading/diagrams/x.smdf.json`, the containerised one says `/data/x.smdf.json`.
> Two rooms, one file. Both write it, neither hears the other, and last-writer-wins
> on a document two people believe they are co-editing.
>
> Pick one shape per directory. `stateloom-setup` is the native one; this is the
> containerised one.

---

## The one-liner

```bash
npx -y @miadi/stateloom-skills docker up
```

That writes a compose project into `./.stateloom/`, creates `./looms/` for the documents,
picks the first free port from 4598 up, starts the loom, waits until every part reports
healthy, and prints:

```
🧵 stateloom is live

   For your human   http://127.0.0.1:4598
   For you (MCP)    http://127.0.0.1:4598/mcp
   Bearer token     3f9c…
   Documents        /abs/path/looms
```

Give your human the first URL. Register yourself against the second.

**Check:** `curl -s http://127.0.0.1:<port>/healthz` returns
`{"ok":true,"gateway":true,"upstreams":{"canvas":true,"hub":true,"mcp":true}}`.

### Choosing the port

```bash
stateloom docker up --port 5599          # exactly this port, or an error if it is taken
stateloom docker up                      # first free port from 4598 up
```

4598 is a convention, not a requirement. The container's own port is 8080 either way, and
nothing inside it knows or cares what it was published as. **Never take a port that another
session is already serving on** — a live loom is somebody's board, not a free resource.

### Everything else

```bash
stateloom docker up --dir ~/machines --doc orders.smdf.json   # where the documents live
stateloom docker up --bind 0.0.0.0                            # serve the network, not just localhost
stateloom docker up --json                                    # machine-readable, for an agent
stateloom docker status                                       # is it healthy
stateloom docker logs canvas                                  # follow one service
stateloom docker down                                         # stop it
```

`--json` gives you `url`, `mcp`, `token`, `document` and a ready-to-paste `mcpConfig` — use
it when you are wiring this up programmatically rather than reading the banner.

---

## The single container

No compose, no project directory, nothing written to disk but your documents:

```bash
mkdir -p looms
docker run --rm -p 4598:8080 \
  -v "$PWD/looms:/data" \
  --user "$(id -u):$(id -g)" \
  jgwill/stateloom
```

The image's default role is `all`: hub, MCP, canvas and gateway supervised inside one
container. Change `4598` to any free host port; the right-hand `8080` never changes.

`--user` matters. Without it the documents are written by uid 1000, and if that is not you,
you cannot edit them afterwards. `/data` is also the **only** directory the canvas and the
MCP server can read or write — a `?doc=` parameter or a `set_project_file` call pointing
anywhere else is refused, not followed.

**Add `-e STATELOOM_CANVAS_URL=http://localhost:4598`** (matching your published port).
Without it, the canvas links the MCP hands you for your human — from `set_project_file` and
`get_project_file` — name port **4598 inside the container**, which is not the port they
opened. On a host that already runs another loom, 4598 is live and belongs to somebody
else's diagram, so the link works and shows the wrong board. The container warns on start
when this is unset; `stateloom docker up` sets it for you.

**Check:** open the URL. The toolbar shows the document name and `⌁ synced`.

---

## Registering the MCP server

The containerised MCP speaks **HTTP**, not stdio, and requires a bearer token. `docker up`
prints one; `stateloom docker mcp-config` prints the registration again later.

```bash
claude mcp add --transport http stateloom http://127.0.0.1:4598/mcp \
  --header "Authorization: Bearer <token>"
```

```json
{
  "mcpServers": {
    "stateloom": {
      "type": "http",
      "url": "http://127.0.0.1:4598/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**The token is not optional and the server will not start without one.** An open MCP port is
unauthenticated read and write of every document under `/data`.

- `stateloom docker up` generates one, writes it into `.stateloom/.env`, and reuses it on
  every later `up` — so a registration keeps working across restarts.
- A bare `docker run` with no `STATELOOM_MCP_TOKEN` generates one, prints it, and keeps it
  in `/data/.stateloom-token` (mode 600) so a restart reuses it rather than silently
  invalidating your registration. Delete that file to roll the token; set
  `STATELOOM_TOKEN_FILE` to move it; set `STATELOOM_MCP_TOKEN` to control it outright:
  `-e STATELOOM_MCP_TOKEN="$(openssl rand -hex 24)"`.
- If `/data` is read-only the token cannot be kept, and the container says so — that is the
  one case where a restart still changes it.

**Check:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4598/mcp     # 401
curl -s -X POST http://127.0.0.1:4598/mcp \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

The second returns a `serverInfo` block naming `stateloom-mcp`.

---

## Switching documents

Every `.json` under `/data` is reachable, and the canvas's **⇄** button lists them: the
panel is fed by `GET /api/docs`, which enumerates exactly what the server's allowlist
admits, and it prints the roots as the server sees them. That last part matters in a
container — your `~/diagrams` is the server's `/data`, and a path is only meaningful in
one of those two vocabularies.

```bash
curl -s http://localhost:4598/api/docs      # {"roots":["/data"],"current":"…","docs":[…]}
```

Three forms of `?doc=`, and only one of them works:

| `?doc=` | result |
|---|---|
| `/data/usd-cad.smdf.json` | **200** — the server's path, which is what the switcher lists |
| `/b/trading/diagrams/usd-cad.smdf.json` | 403 — the *host* path; the server has never heard of it |
| `usd-cad.smdf.json` | 403 — must be absolute |

The refusal names the permitted root and, when that root is `/data`, says what to ask for
instead. An agent switches with `set_project_file /data/<name>`; a human clicks.

Documents are found up to four directories deep, dotfiles and `node_modules` skipped, up to
300 of them.

## The four services, if you want them apart

`stateloom docker up` runs this compose file; it also ships at the root of the smcraft
repository, and it is the same file in both places.

```bash
cp .env.docker.example .env      # STATELOOM_PORT, STATELOOM_DOC_DIR, STATELOOM_MCP_TOKEN
docker compose up -d
```

| service | role | published |
|---|---|---|
| `hub` | the socket.io sequencer; **never writes disk**, safe to restart at any moment | no |
| `mcp` | the agent's door, bearer-token guarded | no |
| `canvas` | the Next.js designer | no |
| `gateway` | the front door — the only thing with a host port | **yes** |

Each container's role comes from `STATELOOM_ROLE`, and each has a role-aware healthcheck, so
`docker compose ps` tells you *which part* is unhealthy rather than that something is.

---

## Running one role

The image is also the four binaries. Any role, and anything else you want to run:

```bash
docker run --rm -v "$PWD/looms:/data" jgwill/stateloom cli \
  smcx --doc /data/statemachine.smdf.json render --as ascii --out -

docker run --rm -v "$PWD/looms:/data" jgwill/stateloom \
  stateloom skills install --all --dir /data/.claude/skills
```

Roles: `all` (default), `gateway`, `hub`, `canvas`, `mcp`, `cli`. Set with the first
argument or with `STATELOOM_ROLE`.

---

## Verification — run all five

| # | Command | Passing result |
|---|---|---|
| 1 | `curl -s $URL/healthz` | `{"ok":true,…}` with all upstreams `true` |
| 2 | `curl -s $URL/api/config` | `{"bridgeUrl":"/","projectFile":"/data/…"}` |
| 3 | `curl -s "$URL/socket.io/?EIO=4&transport=polling"` | `0{"sid":…}` |
| 4 | `curl -s -o /dev/null -w '%{http_code}' -X POST $URL/mcp` | `401` |
| 5 | an MCP `add_state` call, then `grep` the host document | the state is on disk |
| 6 | `curl -s $URL/api/docs` | `"roots":["/data"]` and your documents listed |

(5) is the one that matters. The first four can all pass on a loom whose parts cannot
actually see each other; only a write that lands on the host proves the loop is closed.
`scripts/docker-smoke.sh` in the repository runs exactly these five against any image.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Board loads, toolbar never says `⌁ synced` | Something re-pointed the canvas away from same-origin | `curl $URL/api/config` must say `"bridgeUrl":"/"`. If it names a host, that host is being resolved by the *browser*, and a compose service name never can be. |
| `Permission denied` on the documents afterwards | The container wrote as uid 1000 | `--user "$(id -u):$(id -g)"`, or `STATELOOM_UID`/`STATELOOM_GID` in `.env` |
| `stateloom: /data is not writable by uid …` | The mounted directory belongs to somebody else | `chown` it, or run as the owner |
| MCP returns 401 with the right-looking token | The container restarted and minted a new one | Pin `STATELOOM_MCP_TOKEN`, or re-read it: `stateloom docker mcp-config` |
| `port … is already in use` | Another loom, or another service, holds it | Omit `--port` to take the next free one. Do not evict a running loom — it is somebody's session. |
| The canvas is blank, no errors anywhere | A build shipped without its client bundle | `curl -sI $URL/_next/static/...` for a script the page references; a 404 there is the whole story |
| A canvas link from the MCP opens the wrong board | `STATELOOM_CANVAS_URL` unset, so the link names the container's internal 4598 | Set it to the published origin and restart the `mcp` role |
| The board is empty and `add_state` says "no state machine" | The document file exists but is zero bytes | Delete it and restart — the container seeds an empty file, but only if it is empty on start |
| Two people edit and neither sees the other | A host-native loom and this one share a directory | See the warning at the top: one loom per directory |
| `docker compose is not available` | Only the docker CLI is installed | Install the compose plugin, or use the single-container `docker run` form |

---

## What is where

| Path | What |
|---|---|
| `/data` | your documents — the only readable/writable directory |
| `/data/statemachine.smdf.json` | the default document; seeded on first start if absent |
| `/data/.stateloom-token` | the generated MCP token, kept so a restart does not invalidate it |
| `./.stateloom/docker-compose.yml` | the project `stateloom docker up` writes |
| `./.stateloom/.env` | its settings, including the MCP token and the canvas URL — read back on every command, and only overridden by a flag you actually pass |

Related skills: `stateloom-setup` for the same loom without containers, `stateloom-service`
for systemd units on a host, `stateloom-design` for using the board once it is live.
