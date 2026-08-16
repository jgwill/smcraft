#!/usr/bin/env bash
# =============================================================================
# docker-smoke.sh — prove a stateloom image before anybody trusts it.
#
#   scripts/docker-smoke.sh [image] [--keep]
#
# Starts the image in its default single-container role on a free port with a
# throwaway document directory, then asks the four questions that a broken image
# answers differently:
#
#   1. does the gateway consider every upstream reachable          /healthz
#   2. does the canvas serve a page AND its client bundle          / , /_next/…
#   3. does the hub's engine.io handshake come back through it     /socket.io/
#   4. does the MCP refuse an unauthenticated call, accept an
#      authenticated one, and does a tool call REACH THE DOCUMENT
#      on the host filesystem                                      /mcp
#   5. can a human find their other documents at all                /api/docs
#
# (4) is the one that matters. Every other check can pass on an image whose
# three processes cannot actually see each other; only a write that lands on the
# host proves the loop is closed.
#
# Exits non-zero on the first failure, with the container's logs printed.
# =============================================================================
set -euo pipefail

IMAGE="${1:-jgwill/stateloom:latest}"
[ "${1:-}" = "--keep" ] && IMAGE="jgwill/stateloom:latest"
KEEP=0
for arg in "$@"; do [ "$arg" = "--keep" ] && KEEP=1; done

NAME="stateloom-smoke-$$"
WORK="$(mktemp -d)"
TOKEN="smoke-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
DOC="$WORK/looms/smoke.smdf.json"
mkdir -p "$WORK/looms"

# A free port from the kernel rather than a guess: this runs in CI beside other
# jobs, and a hardcoded port is a flake waiting for a busy runner.
PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"

FAILED=""
cleanup() {
  if [ -n "$FAILED" ]; then
    echo ""
    echo "── container logs ─────────────────────────────────────────────"
    docker logs "$NAME" 2>&1 | tail -60 || true
    echo "───────────────────────────────────────────────────────────────"
  fi
  if [ "$KEEP" = "1" ]; then
    echo "kept: container $NAME, workdir $WORK, port $PORT, token $TOKEN"
    return
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '  %-52s' "$1"; }
ok()   { echo "✓ ${1:-}"; }
die()  { echo "✗ $1"; FAILED=1; exit 1; }

echo "🔎 smoke: $IMAGE on 127.0.0.1:$PORT"

# Deliberately not --rm: a container that dies during boot takes its logs with
# it, and the boot failures are the ones worth reading.
docker run -d \
  --name "$NAME" \
  -p "127.0.0.1:$PORT:8080" \
  -v "$WORK/looms:/data" \
  --user "$(id -u):$(id -g)" \
  -e STATELOOM_PROJECT_FILE=/data/smoke.smdf.json \
  -e STATELOOM_MCP_TOKEN="$TOKEN" \
  "$IMAGE" >/dev/null

BASE="http://127.0.0.1:$PORT"

# ── 1. the gateway's aggregate view ─────────────────────────────────────────
step "gateway /healthz reports every upstream up"
for i in $(seq 1 60); do
  body="$(curl -sf "$BASE/healthz" 2>/dev/null || true)"
  case "$body" in *'"ok":true'*) break ;; esac
  sleep 1
done
case "${body:-}" in
  *'"ok":true'*) ok ;;
  *) die "after 60s: ${body:-no response}" ;;
esac

# ── 2. the canvas, and its client bundle ────────────────────────────────────
# A standalone Next.js build that was assembled without .next/static serves a
# 200 with a blank page and no error anywhere. So the page is not enough: one
# of the scripts it references has to come back too.
step "canvas serves the page"
page="$(curl -sf "$BASE/" || die "GET / failed")"
case "$page" in *"<script"*) ok ;; *) die "no <script> in the page — is this the designer?" ;; esac

step "canvas serves its client bundle"
asset="$(printf '%s' "$page" | grep -o '/_next/static/[^"]*\.js' | head -1 || true)"
[ -n "$asset" ] || die "the page references no /_next/static script"
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$asset")"
[ "$code" = "200" ] || die "$asset → HTTP $code (the board would render blank)"
ok "$(basename "$asset")"

step "canvas is pointed at the same-origin bridge"
config="$(curl -sf "$BASE/api/config" || die "GET /api/config failed")"
case "$config" in *'"bridgeUrl":"/"'*) ok ;; *) die "expected bridgeUrl \"/\", got: $config" ;; esac

# ── 3. the hub, through the gateway ─────────────────────────────────────────
step "hub handshake proxies through the gateway"
hs="$(curl -sf "$BASE/socket.io/?EIO=4&transport=polling" || die "handshake request failed")"
case "$hs" in *'"sid"'*) ok ;; *) die "not an engine.io handshake: $hs" ;; esac

# ── 4. the MCP, and whether a tool call reaches the disk ────────────────────
step "MCP refuses an unauthenticated call"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/mcp")"
[ "$code" = "401" ] || die "expected 401, got $code — the port is unauthenticated"
ok

mcp() {
  curl -sf -X POST "$BASE/mcp" \
    -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d "$1"
}

step "MCP initializes"
init="$(mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' || die "initialize failed")"
case "$init" in *'"serverInfo"'*) ok ;; *) die "no serverInfo: $init" ;; esac

step "a tool call reaches the document on the host"
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add_state","arguments":{"name":"SmokeState"}}}' >/dev/null \
  || die "tools/call add_state failed"
found=""
for i in $(seq 1 15); do
  if [ -f "$DOC" ] && grep -q 'SmokeState' "$DOC"; then found=1; break; fi
  sleep 1
done
[ -n "$found" ] || die "add_state never landed in $DOC — the loop is not closed"
ok

# ── 5. can the human find their other documents ─────────────────────────────
# The allowlist admitted them all along; the way to SEE them is what shipped
# late. Without this the ⇄ switcher is a path prompt for paths only the server
# knows. (Found in review.)
step "the canvas lists the documents it will admit"
printf '{}' > "$WORK/looms/second.smdf.json"
docs="$(curl -sf "$BASE/api/docs" || die "GET /api/docs failed — an old canvas build?")"
case "$docs" in *'"roots":["/data"]'*) : ;; *) die "roots should be [\"/data\"], got: $docs" ;; esac
case "$docs" in *second.smdf.json*) ok ;; *) die "a document in the mount is not listed: $docs" ;; esac

# The refusal a human meets when they paste the path they can actually see.
step "a host path is refused in words that name /data"
refusal="$(curl -s "$BASE/api/file?doc=/b/trading/diagrams/x.smdf.json")"
case "$refusal" in *"/data"*) ok ;; *) die "refusal does not mention /data: $refusal" ;; esac

echo ""
echo "✅ $IMAGE — the loom is live on one port, an agent's edit reaches the disk,"
echo "   and a human can find the other documents."
