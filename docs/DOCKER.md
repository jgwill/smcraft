# The stateloom container

`jgwill/stateloom` — one image, five roles, one published port.

This document is the *why*. For using it, read the `stateloom-docker` skill
(`skills/stateloom-docker/SKILL.md`); for the shortest path, the Docker section of the
README.

---

## What has to be true for a loom to work

A loom is five agreements, and every one of them fails silently when broken:

| Agreement | Broken looks like |
|---|---|
| Every surface resolves the **same absolute document path** | the toolbar reads `○ no disk`; two processes edit two files |
| Every surface reaches the **same hub** | the board loads and never animates |
| The **browser** can reach that hub *from where the browser is* | identical to the above, and the server-side config looks perfectly correct |
| The document directory is **writable by the process** | the first save fails, long after setup "succeeded" |
| Every surface agrees which **vocabulary** a path is in | the agent hands its human a link to somebody else's board |

A document is a `.smdf.json` (a state machine) or a `.erdf.json` (the entity-relationship
diagram of the data those machines act on — Spec 80). The container treats both the same
way: same mount, same allowlist, same hub room keyed by the resolved path. Only the
workspace the canvas opens differs, and it decides that from the extension.

That last agreement is the container's own contribution and the review found three of it:
`/data/x.smdf.json` and `/home/you/diagrams/x.smdf.json` are the same file under two names,
and code that hands one across the boundary produces something that looks right and is not.
`STATELOOM_CANVAS_URL`, `GET /api/docs` and the refusal wording in `resolveDocPath` are all
the same fix — say which vocabulary you are speaking, to whoever is listening.

Containers make the third one much worse. `STATELOOM_BRIDGE_URL=http://hub:4599` is correct
inside a compose network and meaningless in a browser; `http://localhost:4599` is correct
for a browser on the host and wrong for one on a tailnet. There is no single value that is
right, which is why the containerised design does not use one.

---

## The shape

```
                         docker
   ┌────────────────────────────────────────────────────┐
   │   gateway  :8080   ← the only published port        │
   │      │                                              │
   │      ├── /socket.io/*   →   hub     :4599           │
   │      ├── /mcp           →   mcp     :4600           │
   │      ├── /healthz       →   itself                  │
   │      └── everything     →   canvas  :4598           │
   └────────────────────────────────────────────────────┘
                              │
                        /data   the documents
```

**The gateway is the design.** With everything behind one origin, the canvas is configured
with `STATELOOM_BRIDGE_URL=/` — not a host, not a port, not an address of any kind. The
browser resolves it against the page it is already on, so the third agreement above holds
by construction for localhost, LAN, tailnet, and a TLS reverse proxy alike, with no
configuration that could be wrong.

It also means the agent's MCP endpoint is `<same URL>/mcp`. One address to hand out, one
port to open in a firewall, one thing to put TLS in front of.

`docker/gateway.mjs` is ~150 dependency-free lines: an HTTP proxy plus an `upgrade` handler
that splices the two raw sockets, because Node does not proxy a websocket for you and
without that the canvas silently degrades to long-polling, or to nothing.

## The five roles

One image, because four images of the same five npm packages is four times the pull and
four chances to publish a mismatched set.

| Role | Process |
|---|---|
| `all` *(default)* | all four, supervised by `docker/supervise.mjs` — the single-container form |
| `gateway` | the proxy alone — compose's front door |
| `hub` | `smcraft-bridge` |
| `canvas` | `stateloom-web` |
| `mcp` | `stateloom-mcp` in HTTP mode |
| `cli` | no server; runs `smcx`, `stateloom`, or whatever you pass |

The role comes from `$1` or from `STATELOOM_ROLE`, in that order. **There is deliberately no
`CMD`** in the Dockerfile: a default CMD arrives at the entrypoint indistinguishable from an
argument the operator typed, so it would beat `-e STATELOOM_ROLE=…` and every compose
service would quietly run the whole loom. That is not hypothetical — it is what the first
version of this did, and the symptom was four healthy containers and a 401 from an MCP
nobody had the token for.

The entrypoint writes the role it resolved to `/tmp/stateloom-role`, because the
`HEALTHCHECK` runs as its own exec and inherits the *image's* environment, not the
entrypoint's.

## Supervision

`docker/supervise.mjs` exists because busybox `ash` has no dependable `wait -n`: "exit when
any child dies" degrades to "hang until the last one does", which presents as a healthy
container with a dead canvas inside it. It never restarts a child — restart policy belongs
to the layer above (compose `restart:`, systemd, k8s), and that layer can only own it if
this process is honest about dying.

---

## Why the image installs from npm

Every other artefact here is built from source and then published. The image is deliberately
the other way round: it `npm install -g`s the **published** packages at pinned versions.

That makes the image the *integration test of the release* rather than a second, parallel
build of it. A source-built image proves the source compiles — which the release already
proved five other ways. An npm-built image proves the tarballs on the registry actually work
together, which nothing else can tell you.

The consequence is an ordering rule the release workflow follows:

```
verify    build the image against `latest`, smoke it, push nothing
          → proves the Dockerfile and the wiring, spends no approval

release   docker login          ← before anything irreversible; a bad token must
                                  fail while npm is still untouched
          npm publish           ← irreversible
          docker build (pinned to what just published)
          smoke test
          docker push
```

A failure after `npm publish` leaves npm published with no image. That is the right way
round: npm is the artifact, the image is derived from it, and `./docker-build-push.sh --push`
from the released commit fixes it without republishing anything.

### The image has its own version line

`docker/VERSION`, not any package's version. The image changes when any of five pinned
packages changes, or when the Dockerfile, gateway or supervisor does — so borrowing one
package's number would let two different images claim one tag. `docker push` overwrites
silently and forever; the workflow refuses to push a numbered tag that already exists.

---

## The smoke test

`scripts/docker-smoke.sh` starts the image on a kernel-chosen free port with a throwaway
document directory and asks six questions:

1. `/healthz` — does the gateway consider every upstream reachable
2. `/` **and one of its `/_next/static/*.js`** — a standalone build assembled without
   `.next/static` serves a 200 and a blank page with no error anywhere
3. `/socket.io/?EIO=4` — does the hub's engine.io handshake come back through the proxy
4. `POST /mcp` unauthenticated → `401`, then authenticated → `serverInfo`
5. an MCP `add_state`, then `grep` the document **on the host filesystem**
6. `GET /api/docs` lists a second document, and a host path is refused in words naming
   `/data`

(5) is the one that matters. The first four can all pass on a loom whose parts cannot see
each other; only a write that lands on the host proves the loop is closed. (6) is the one
that decides whether switching diagrams is a feature or a path prompt.

---

## Security posture

- **Non-root.** `USER node`, and `--user "$(id -u):$(id -g)"` in every documented
  invocation, so documents written inside are editable outside.
- **`/data` is the only reachable directory.** `STATELOOM_DOC_ROOTS=/data` bounds the
  canvas's `?doc=` parameter; `STATELOOM_MCP_ROOT=/data` bounds `set_project_file`. Both
  refuse rather than follow.
- **The MCP requires a bearer token and will not start in HTTP mode without one** — an open
  port there is unauthenticated read and write of everything under `/data`. The entrypoint
  generates one, prints it, and persists it to `/data/.stateloom-token` (mode 600) so a
  restart reuses it rather than silently invalidating a registration; `stateloom docker up`
  keeps its own in `.stateloom/.env`. `STATELOOM_MCP_TOKEN` overrides both.
- **`x-forwarded-proto` is passed through, not asserted.** The gateway forwards an outer
  proxy's value when there is one. Same-origin `/` means the socket URL never depended on
  it, but anything reconstructing an absolute origin behind TLS would have been told
  `http`.
- **Loopback by default.** Compose publishes on `127.0.0.1` unless `STATELOOM_BIND` says
  otherwise. Nothing in this stack terminates TLS.

---

## Files

| Path | What |
|---|---|
| `Dockerfile` | the image; `ARG`s pin the five npm packages |
| `.dockerignore` | `*` then four un-ignores — the build context is a few KiB |
| `docker/entrypoint.sh` | role dispatch, document seeding, token generation |
| `docker/supervise.mjs` | the `all` role |
| `docker/gateway.mjs` | the one-port proxy, websockets included |
| `docker/healthcheck.sh` | role-aware; asks each role the question only it can answer |
| `docker/VERSION` | the image's own version line |
| `web/src/app/api/docs/route.ts` | the listing the ⇄ switcher renders — bounded by `listDocuments()` to the same roots `resolveDocPath` enforces |
| `docker-compose.yml` | the four-service form — **canonical**, mirrored into `@miadi/stateloom-skills` |
| `.env.docker.example` | its settings |
| `docker-build-push.sh` | build, smoke, optionally push |
| `scripts/docker-smoke.sh` | the five questions |

`docker-compose.yml` is mirrored into the skills package by
`skills-cli/scripts/sync-docker.mjs` at build and prepack, the same way the skill pack is.
`stateloom docker up` runs *that* file — one canonical compose file, so what an agent runs
through `npx` and what a contributor reads on GitHub cannot drift apart.
