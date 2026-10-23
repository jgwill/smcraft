# =============================================================================
# stateloom — the whole loom in one image
# jgwill/stateloom
#
#   docker run --rm -p 4598:8080 -v "$PWD/looms:/data" jgwill/stateloom
#   → open http://localhost:4598
#
# Pick any host port you like; 8080 is the container's single front door and
# nothing inside cares what it is published as.
#
# ── why this image installs from npm instead of building the repo ───────────
# Every other artefact in this repository is built from source and then
# published. The image is deliberately the other way round: it installs the
# PUBLISHED packages at pinned versions. That makes the image the integration
# test of the release rather than a second, parallel build of it — if this
# container comes up healthy, the tarballs on npm genuinely work together, which
# is the one thing a source build can never tell you.
#
# The release workflow therefore builds it twice: once in `verify` against
# whatever is currently on npm (proving the Dockerfile itself, spending no
# approval), and once in `release` after publishing, pinned to the new versions,
# which is the image that gets pushed.
# =============================================================================
FROM node:22-alpine

# Pinned by the release workflow and by ./docker-build-push.sh, which read them
# out of the repository's manifests. `latest` is the honest default for a hand
# `docker build .` — it is what an unpinned `npm i -g` would give you anyway.
ARG STATELOOM_HUB_VERSION=latest
ARG STATELOOM_WEB_VERSION=latest
ARG STATELOOM_MCP_VERSION=latest
ARG STATELOOM_CLI_VERSION=latest
ARG STATELOOM_SKILLS_VERSION=latest

LABEL org.opencontainers.image.title="stateloom" \
      org.opencontainers.image.description="The stateloom state-machine design loom: hub, visual canvas, MCP server and CLI behind one port" \
      org.opencontainers.image.source="https://github.com/jgwill/smcraft" \
      org.opencontainers.image.licenses="MIT"

# tini reaps the zombies a supervised multi-process container otherwise
# accumulates, and makes Ctrl-C reach the supervisor as a real SIGINT.
RUN apk add --no-cache tini

RUN npm install -g --omit=dev \
      "@miadi/stateloom@${STATELOOM_HUB_VERSION}" \
      "@miadi/stateloom-web@${STATELOOM_WEB_VERSION}" \
      "@miadi/stateloom-mcp@${STATELOOM_MCP_VERSION}" \
      "@miadi/stateloom-cli@${STATELOOM_CLI_VERSION}" \
      "@miadi/stateloom-skills@${STATELOOM_SKILLS_VERSION}" \
    && npm cache clean --force

COPY docker/gateway.mjs docker/supervise.mjs /opt/stateloom/
COPY docker/entrypoint.sh docker/healthcheck.sh /usr/local/bin/
# Explicit modes, not `chmod +x`. COPY carries the host's bits through, and a
# repository checked out under a restrictive umask arrives as rw-rw----; `+x`
# then yields rwxrwx--x, which the *runtime* user cannot READ. The container
# fails with "can't open entrypoint.sh: Permission denied" and nothing about
# that message points at the umask on the machine that built it.
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/healthcheck.sh \
    && chmod 0644 /opt/stateloom/gateway.mjs /opt/stateloom/supervise.mjs

# The mount point exists in the image and belongs to the runtime user, so a
# plain `-v ./looms:/data` works without a chown dance on the host.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    STATELOOM_ROLE=all \
    STATELOOM_PROJECT_FILE=/data/statemachine.smdf.json \
    STATELOOM_DOC_ROOTS=/data \
    STATELOOM_MCP_ROOT=/data \
    STATELOOM_BRIDGE_PORT=4599 \
    STATELOOM_WEB_PORT=4598 \
    STATELOOM_MCP_HTTP_PORT=4600 \
    STATELOOM_GATEWAY_PORT=8080

# Not root. The container writes to a host directory; running as uid 1000 means
# the files it creates belong to a normal user rather than to root, which is the
# difference between a mount you can edit afterwards and one you cannot.
USER node

# 8080 is the only port anything outside needs. The rest are published only by
# someone who deliberately wants to bypass the gateway.
EXPOSE 8080
EXPOSE 4598 4599 4600

HEALTHCHECK --interval=15s --timeout=6s --start-period=25s --retries=4 \
  CMD /usr/local/bin/healthcheck.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]

# Deliberately NO `CMD ["all"]`. A default CMD arrives at the entrypoint as $1,
# indistinguishable from a role the operator typed — so it would silently beat
# `-e STATELOOM_ROLE=mcp` and every compose service would run the whole loom.
# The default lives in STATELOOM_ROLE above instead, where an env override
# actually overrides it and an explicit argument still wins over both.
