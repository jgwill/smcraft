#!/usr/bin/env bash
# =============================================================================
# Build (and optionally push) jgwill/stateloom.
#
#   ./docker-build-push.sh              build only, pinned to this tree's versions
#   ./docker-build-push.sh --push       build and push :<version> and :latest
#   ./docker-build-push.sh --latest     build against npm's `latest`, not the pins
#   ./docker-build-push.sh --tag 0.2.0  override the image tag
#
# The image installs the PUBLISHED @miadi/stateloom-* packages, so the versions
# it pins are read out of this repository's manifests rather than guessed. A
# version that is not on npm yet fails the build here, loudly, which is the
# whole point: an image can only be built for a release that has landed.
#
# Requires `docker login` as the account that owns jgwill/stateloom.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${STATELOOM_IMAGE_NAME:-jgwill/stateloom}"

PUSH=0
USE_LATEST=0
SMOKE=1
TAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --push)     PUSH=1 ;;
    --latest)   USE_LATEST=1 ;;
    --no-smoke) SMOKE=0 ;;   # CI runs it as its own step so the summary can tell
                             # "the image built" from "the image works"
    --tag)      TAG="${2:?--tag needs a value}"; shift ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

ver() { node -p "require('$ROOT/$1/package.json').version"; }

# The image has its OWN version line, in docker/VERSION, and it has to: the
# image changes when ANY of five pinned packages changes, or when the Dockerfile
# or the gateway does. Borrowing one package's version would mean two different
# images could legitimately claim the same tag — and a docker push overwrites,
# silently, forever. Bump docker/VERSION whenever what the image contains moves.
IMAGE_VERSION="$(tr -d '[:space:]' < "$ROOT/docker/VERSION")"

if [ "$USE_LATEST" = "1" ]; then
  V_HUB=latest; V_WEB=latest; V_MCP=latest; V_CLI=latest; V_SKILLS=latest
  TAG="${TAG:-latest}"
else
  V_HUB="$(ver bridge)"
  V_WEB="$(ver web-dist)"
  V_MCP="$(ver mcp)"
  V_CLI="$(ver cli)"
  V_SKILLS="$(ver skills-cli)"
  TAG="${TAG:-$IMAGE_VERSION}"
fi

echo "🐳 ${IMAGE}:${TAG}   (image version ${IMAGE_VERSION})"
echo "   hub    @miadi/stateloom@${V_HUB}"
echo "   web    @miadi/stateloom-web@${V_WEB}"
echo "   mcp    @miadi/stateloom-mcp@${V_MCP}"
echo "   cli    @miadi/stateloom-cli@${V_CLI}"
echo "   skills @miadi/stateloom-skills@${V_SKILLS}"
echo ""

docker build \
  --build-arg "STATELOOM_HUB_VERSION=${V_HUB}" \
  --build-arg "STATELOOM_WEB_VERSION=${V_WEB}" \
  --build-arg "STATELOOM_MCP_VERSION=${V_MCP}" \
  --build-arg "STATELOOM_CLI_VERSION=${V_CLI}" \
  --build-arg "STATELOOM_SKILLS_VERSION=${V_SKILLS}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  "$ROOT"

# Prove it before offering it. A built image that never came up is not evidence
# of anything, and the failure this catches — a package combination that
# installs but cannot talk to itself — is exactly the one a Dockerfile hides.
if [ "$SMOKE" = "1" ]; then
  echo ""
  echo "🔎 smoke test"
  "$ROOT/scripts/docker-smoke.sh" "${IMAGE}:${TAG}"
fi

if [ "$PUSH" = "1" ]; then
  echo ""
  echo "📤 pushing ${IMAGE}:${TAG} and ${IMAGE}:latest"
  docker push "${IMAGE}:${TAG}"
  docker push "${IMAGE}:latest"
fi

cat <<EOF

✅ ${IMAGE}:${TAG}

Run it:
  docker run --rm -p 4598:8080 -v "\$PWD/looms:/data" ${IMAGE}:${TAG}
  open http://localhost:4598

Or the four-service form:
  cp .env.docker.example .env && docker compose up -d
EOF
