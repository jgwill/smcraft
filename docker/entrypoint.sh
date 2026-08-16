#!/bin/sh
# =============================================================================
# stateloom container entrypoint — one image, five roles.
#
#   all      hub + MCP + canvas + gateway in this container, ONE published port
#            (the default: `docker run -p 4598:8080 jgwill/stateloom`)
#   gateway  reverse proxy only — compose's front door
#   hub      the socket.io sequencer            (@miadi/stateloom)
#   canvas   the visual designer                (@miadi/stateloom-web)
#   mcp      the agent's MCP server over HTTP   (@miadi/stateloom-mcp)
#   cli      no server; runs `smcx …` / `stateloom …` / any command you pass
#
# Set the role with $STATELOOM_ROLE or as the first argument. Anything that is
# not a known role is executed verbatim, so `docker run … stateloom-image smcx
# presence` behaves the way a person expects a container to behave.
# =============================================================================
set -e

DOC="${STATELOOM_PROJECT_FILE:-/data/statemachine.smdf.json}"
export STATELOOM_PROJECT_FILE="$DOC"
# Every surface honors the legacy twin; exporting both means a registration
# written before the 2026-07 rename keeps working inside the container too.
export SMCRAFT_PROJECT_FILE="$DOC"

# The document's directory is the only place the canvas may read or write, and
# the only place the MCP may be re-pointed to. Both default to /data, which is
# the mount — so nothing in the image's own filesystem is reachable through a
# `?doc=` parameter or a `set_project_file` call.
export STATELOOM_DOC_ROOTS="${STATELOOM_DOC_ROOTS:-/data}"
export STATELOOM_MCP_ROOT="${STATELOOM_MCP_ROOT:-/data}"

HUB_PORT="${STATELOOM_BRIDGE_PORT:-4599}"
WEB_PORT="${STATELOOM_WEB_PORT:-4598}"
MCP_PORT="${STATELOOM_MCP_HTTP_PORT:-4600}"
GATEWAY_PORT="${STATELOOM_GATEWAY_PORT:-8080}"

ROLE="${1:-}"
if [ -n "$ROLE" ]; then
  case "$ROLE" in
    all|gateway|hub|canvas|mcp|cli) shift ;;
    *) ROLE="" ;;
  esac
fi
[ -n "$ROLE" ] || ROLE="${STATELOOM_ROLE:-all}"
export STATELOOM_ROLE="$ROLE"

# The healthcheck runs as its own exec and inherits the IMAGE's environment, not
# this process's — so an export is invisible to it and a container started as
# `docker run image hub` would be health-checked as an `all`. The resolved role
# is written where both can see it.
echo "$ROLE" > /tmp/stateloom-role 2>/dev/null || true

# ── the document ────────────────────────────────────────────────────────────
# Seeded when absent, never touched when present. An empty board that cannot be
# rendered, validated or code-generated until somebody presses a button is a
# worse first thirty seconds than a Root state waiting to be filled.
seed_document() {
  dir=$(dirname "$DOC")
  mkdir -p "$dir" 2>/dev/null || true
  if [ ! -w "$dir" ]; then
    echo "stateloom: $dir is not writable by uid $(id -u)." >&2
    echo "  The mounted directory must be writable by the container user." >&2
    echo "  Fix on the host:  sudo chown -R $(id -u):$(id -g) <your-mount>" >&2
    echo "  Or run as yourself:  docker run --user \"\$(id -u):\$(id -g)\" …" >&2
    exit 1
  fi
  [ -e "$DOC" ] && return 0
  name=$(basename "$DOC" | sed 's/\.smdf\.json$//; s/\.json$//')
  cat > "$DOC" <<JSON
{
  "stateMachine": {
    "settings": { "namespace": "Stateloom", "name": "${name}", "asynchronous": false },
    "events": [ { "name": "Internal", "events": [] } ],
    "state": { "name": "Root", "states": [] }
  }
}
JSON
  echo "stateloom: seeded a new document at $DOC" >&2
}

# ── the MCP token ───────────────────────────────────────────────────────────
# The MCP server refuses HTTP mode without one, and it is right to: an open port
# there is unauthenticated read and write of everything under /data. Generating
# one keeps the zero-configuration path open; printing it is what makes the
# generated one usable. A container restart mints a new token, so anything
# long-lived should pin STATELOOM_MCP_TOKEN in its env file.
ensure_mcp_token() {
  [ -n "$STATELOOM_MCP_TOKEN" ] && return 0
  STATELOOM_MCP_TOKEN=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
  export STATELOOM_MCP_TOKEN
  echo "" >&2
  echo "stateloom: no STATELOOM_MCP_TOKEN was set — generated one for this run:" >&2
  echo "" >&2
  echo "    $STATELOOM_MCP_TOKEN" >&2
  echo "" >&2
  echo "  It changes on every restart. Pin it in your env file to keep an MCP" >&2
  echo "  registration working across restarts." >&2
  echo "" >&2
}

case "$ROLE" in
  hub)
    seed_document
    echo "stateloom hub → 0.0.0.0:$HUB_PORT   document: $DOC" >&2
    exec smcraft-bridge --port "$HUB_PORT" --host 0.0.0.0 --doc "$DOC"
    ;;

  canvas)
    seed_document
    # Behind the gateway this is "/" and needs no thought. Reached directly, it
    # must be the hub's address AS THE BROWSER SEES IT — a compose service name
    # resolves inside the network and nowhere a browser can follow.
    if [ -z "$STATELOOM_BRIDGE_URL" ]; then
      echo "stateloom: STATELOOM_BRIDGE_URL is unset — the canvas will save to disk," >&2
      echo "  but no agent or terminal will see the edits. Behind the gateway set it" >&2
      echo "  to \"/\"; reached directly, set it to the hub URL the BROWSER can reach." >&2
    fi
    echo "stateloom canvas → 0.0.0.0:$WEB_PORT   document: $DOC" >&2
    exec stateloom-web --port "$WEB_PORT" --host 0.0.0.0 --doc "$DOC"
    ;;

  mcp)
    seed_document
    ensure_mcp_token
    export STATELOOM_MCP_HTTP_PORT="$MCP_PORT"
    export STATELOOM_MCP_HTTP_HOST="${STATELOOM_MCP_HTTP_HOST:-0.0.0.0}"
    exec stateloom-mcp
    ;;

  gateway)
    exec node /opt/stateloom/gateway.mjs
    ;;

  all)
    seed_document
    if [ "${STATELOOM_WITH_MCP:-1}" != "0" ]; then ensure_mcp_token; fi
    exec node /opt/stateloom/supervise.mjs
    ;;

  cli)
    seed_document
    if [ "$#" -eq 0 ]; then exec smcx --help; fi
    exec "$@"
    ;;

  *)
    exec "$@"
    ;;
esac
