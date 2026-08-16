#!/bin/sh
# Role-aware container health. Each role is asked the question that would fail
# if that role were broken — not a generic "is a port open", which stays true
# for a canvas serving 500s and for a hub that has stopped accepting handshakes.
set -e

# The role the entrypoint actually resolved — which is not necessarily the one
# in the environment this exec inherits (see entrypoint.sh).
ROLE="$(cat /tmp/stateloom-role 2>/dev/null || true)"
[ -n "$ROLE" ] || ROLE="${STATELOOM_ROLE:-all}"
HUB_PORT="${STATELOOM_BRIDGE_PORT:-4599}"
WEB_PORT="${STATELOOM_WEB_PORT:-4598}"
MCP_PORT="${STATELOOM_MCP_HTTP_PORT:-4600}"
GATEWAY_PORT="${STATELOOM_GATEWAY_PORT:-8080}"

get() { wget -q -T 4 -O - "$1"; }

case "$ROLE" in
  # /healthz dials every upstream, so one call covers the whole loom.
  all|gateway) get "http://127.0.0.1:$GATEWAY_PORT/healthz" | grep -q '"ok":true' ;;
  # The engine.io handshake — the hub's actual job, not merely its socket.
  hub)         get "http://127.0.0.1:$HUB_PORT/socket.io/?EIO=4&transport=polling" | grep -q '"sid"' ;;
  # The route the browser asks before it can connect to anything.
  canvas)      get "http://127.0.0.1:$WEB_PORT/api/config" | grep -q 'projectFile' ;;
  mcp)         get "http://127.0.0.1:$MCP_PORT/health" | grep -q '"ok":true' ;;
  *)           exit 0 ;;
esac
