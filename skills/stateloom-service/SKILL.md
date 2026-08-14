---
name: stateloom-service
description: Keep the stateloom loom running as long-lived background services instead of foreground terminals. Use when installing the hub and canvas as systemd user units from the published npm packages, running stateloom on a headless box or after logout, choosing between npx and a global install, pinning versions in a stack env file, upgrading to a newly published @miadi/stateloom-web or @miadi/stateloom and restarting onto it, rolling a version back, or diagnosing a restart that kept serving the old interface.
---

# The loom as a service

`stateloom-setup` gets the pair running in two terminals. That is right for a session and
wrong for a machine: close the terminal and the board is gone, and nothing brings it back
after a reboot. This skill is the other shape — the same two processes as **supervised
background services**, installed from npm with no repository on the host at all.

```
   systemd --user
   ├── stateloom-hub.service      smcraft-bridge   → 127.0.0.1:4599   (@miadi/stateloom)
   └── stateloom-canvas.service   stateloom-web    → 127.0.0.1:4598   (@miadi/stateloom-web)
                                        │
                            one stack env file holds
                            the ports, the document,
                            and the version pins
```

Two facts shape everything below:

1. **The units run installed binaries, not a checkout.** Which is why upgrading is an npm
   act, and `systemctl restart` on its own faithfully restarts the old version.
2. **The hub never writes disk.** Restarting it cannot corrupt a document. The canvas
   writes only when a human presses 💾. Both are safe to bounce at any moment.

---

## Step 1 — Install the binaries globally

Deliberately **not** `npx`. A service that resolves its own package on every start is a
service that changes version when a cache expires, and that fails to start at all when the
network is down at boot.

```bash
npm i -g @miadi/stateloom @miadi/stateloom-web
```

**Verify:**

```bash
smcraft-bridge --version
stateloom-web --version
```

Both must print. If `command not found`, the npm global bin is not on the PATH systemd
will use — capture the absolute path now, because the units below need it:

```bash
npm bin -g 2>/dev/null || dirname "$(command -v stateloom-web)"
```

Do not continue past a missing binary.

---

## Step 2 — Write the stack env file

One file, read by both units and by every later upgrade. Keep it outside any repo — it
describes *this host*, not the software.

```bash
mkdir -p "$HOME/.stateloom"
cat > "$HOME/.stateloom/stack.env" <<'EOF'
# The document every surface agrees on. MUST be absolute.
STATELOOM_PROJECT_FILE=/absolute/path/to/board.smdf.json
STATELOOM_WEB_PORT=4598
STATELOOM_BRIDGE_PORT=4599
STATELOOM_BIND_HOST=127.0.0.1
# What the CANVAS TELLS THE BROWSER to dial. Leave as loopback for a local-only
# box; set it to the public origin when the pair is published (see stateloom-tailnet).
STATELOOM_BROWSER_BRIDGE_URL=http://127.0.0.1:4599
# Version pins — what is installed right now. Kept true by the upgrade step.
STATELOOM_V_HUB=0.0.0
STATELOOM_V_WEB=0.0.0
EOF
```

`STATELOOM_PROJECT_FILE` must be absolute. Two processes resolving one relative path
against two working directories is the defect this prevents, and it presents as a canvas
reporting `○ no disk` while an agent writes happily somewhere else.

---

## Step 3 — Write the two units

`systemd --user`, not system units: the loom runs as a person, reads that person's
documents, and needs no root anywhere in this skill.

```bash
NVM_BIN="$(dirname "$(command -v stateloom-web)")"
UNIT="$HOME/.config/systemd/user"; mkdir -p "$UNIT"

cat > "$UNIT/stateloom-hub.service" <<EOF
[Unit]
Description=StateLoom bridge hub on 127.0.0.1:4599
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$HOME/.stateloom/stack.env
ExecStart=$NVM_BIN/smcraft-bridge --host 127.0.0.1 --port 4599 --doc /absolute/path/to/board.smdf.json
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "$UNIT/stateloom-canvas.service" <<EOF
[Unit]
Description=StateLoom canvas on 127.0.0.1:4598
After=network-online.target stateloom-hub.service
Wants=network-online.target stateloom-hub.service

[Service]
Type=simple
EnvironmentFile=$HOME/.stateloom/stack.env
# --bridge is what the BROWSER is told to dial, not what this process connects to.
ExecStart=$NVM_BIN/stateloom-web --host 127.0.0.1 --port 4598 --doc /absolute/path/to/board.smdf.json --bridge http://127.0.0.1:4599
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
```

The canvas `Wants=` the hub so the ordering is declared rather than lucky. It does not
`Requires=` it: a canvas with no hub is still a working editor on a real file.

**Linger** — without it every unit dies at logout and never starts at boot:

```bash
loginctl enable-linger "$USER"        # may need sudo on some distributions
systemctl --user daemon-reload
systemctl --user enable --now stateloom-hub.service stateloom-canvas.service
```

**Verify:**

```bash
systemctl --user is-active stateloom-hub stateloom-canvas       # active, active
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4598/
curl -sS 'http://127.0.0.1:4599/socket.io/?EIO=4&transport=polling' | head -c 40
curl -sS http://127.0.0.1:4598/api/config
```

The last line is load-bearing. `GET /api/config` is the canvas answering *"which hub should
your browser dial?"* — resolved at runtime from the serving process, which is what lets a
prebuilt canvas carry nobody's URL baked in. If it reports a loopback address while people
reach the canvas by any other name, remote browsers will render a board that never moves.

---

## Step 4 — Upgrade onto a new release

The trap this step exists for: **`systemctl restart` restarts what is installed.** After a
release, that is still the old version. Three records have to move together.

```bash
# 1. what actually executes
npm i -g @miadi/stateloom-web@latest @miadi/stateloom@latest

# 2. the pins the units and any future re-install read
sed -i "s|^STATELOOM_V_WEB=.*|STATELOOM_V_WEB=$(npm view @miadi/stateloom-web version)|" \
       "$HOME/.stateloom/stack.env"
sed -i "s|^STATELOOM_V_HUB=.*|STATELOOM_V_HUB=$(npm view @miadi/stateloom version)|" \
       "$HOME/.stateloom/stack.env"

# 3. the running processes — hub first, the canvas Wants= it
systemctl --user restart stateloom-hub.service
systemctl --user restart stateloom-canvas.service
```

**Verify you are actually on the new one:**

```bash
node -p "require('$(npm root -g)/@miadi/stateloom-web/package.json').version"
systemctl --user is-active stateloom-canvas
```

Then **hard-refresh the browser tab** (Ctrl+Shift+R / Cmd+Shift+R). The canvas is a
Next.js app; the previous JS bundle is cached client-side, and a soft reload can hand back
the exact interface you just replaced — indistinguishable from a failed deploy.

**Rollback** is the same three steps with a version instead of `latest`:
`npm i -g @miadi/stateloom-web@0.1.2`, fix the pin, restart.

### A script for it

Worth writing once per host, because the failure mode is silent. Minimum contents:
resolve `latest` from the registry, install only what moved, rewrite the `STATELOOM_V_*`
pins, restart hub-then-canvas, and print the live status plus the installed versions so
the upgrade proves itself instead of being assumed.

---

## Step 5 — Point the agents at it

The MCP server is **not** a service and must not be added here. Each agent spawns its own
`npx @miadi/stateloom-mcp` child process over stdio, with that agent's own trust; a shared
long-lived MCP would give every caller one shared board. Register it per agent:

```json
{
  "mcpServers": {
    "stateloom": {
      "command": "npx",
      "args": ["-y", "@miadi/stateloom-mcp"],
      "env": {
        "STATELOOM_PROJECT_FILE": "/absolute/path/to/board.smdf.json",
        "STATELOOM_BRIDGE_URL": "http://127.0.0.1:4599"
      }
    }
  }
}
```

Because it is spawned per session, an MCP upgrade needs no restart of anything — the next
agent session picks it up. That also means restarting the stack never disturbs a
conversation in flight.

---

## Diagnosing

| Symptom | Cause | Move |
|---|---|---|
| Restart "worked", interface unchanged | cached browser bundle, or npm never moved | hard-refresh; then check the installed version under `npm root -g` |
| `Active: failed`, exit 203 | `ExecStart` path wrong — systemd does not read your shell PATH | re-derive `dirname "$(command -v stateloom-web)"`, absolute paths only |
| Both units die at logout | linger not enabled | `loginctl enable-linger "$USER"` |
| Canvas shows `○ no disk` | relative or mismatched `--doc` | make every path absolute and identical across units and agents |
| Board renders, never moves, no error | the browser dialled a hub it cannot reach | read `GET /api/config`; fix `--bridge` on the canvas unit |
| Port already in use at start | a foreground `stateloom-setup` loop is still running | stop that terminal, or move this stack to another port pair |
| `list-units` shows an old version in the description | the `Description=` was never refreshed | edit the unit text and `daemon-reload` — it is what every future reader sees |

Logs, always, before guessing:

```bash
journalctl --user -u stateloom-canvas -n 50 --no-pager
journalctl --user -u stateloom-hub -n 50 --no-pager
```

---

## Related

- `stateloom-setup` — the foreground two-terminal form, and the environment contract
- `stateloom-live-loop` — what the hub actually does once it is up
- `stateloom-tailnet` — publishing this pair beyond loopback, on a private tailnet
