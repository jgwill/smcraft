---
name: stateloom-tailnet
description: Publish a running stateloom loom on a private Tailscale tailnet so the board can be watched and driven from any of your devices. Use when exposing the canvas and bridge hub beyond 127.0.0.1, registering a Tailscale named Service with two endpoints on one hostname, provisioning and renewing its TLS certificate, setting the runtime bridge URL a remote browser will dial, or diagnosing a remotely-rendered diagram that never moves, a mixed-content block, or a service host stuck pending approval.
---

# Publishing the loom on a tailnet

The loom binds loopback on purpose. This skill lifts it onto a **private** network — a
Tailscale tailnet, reachable only by devices you have enrolled — under one short HTTPS
name, without a public port, a reverse proxy, or any change to stateloom itself.

```
   https://<service>.<your-tailnet>.ts.net         →  127.0.0.1:4598   canvas
   https://<service>.<your-tailnet>.ts.net:4599    →  127.0.0.1:4599   bridge hub
                         one Service, two endpoints, both TLS
```

Prerequisite: the pair is already running and answering on loopback. Get there with
`stateloom-service` (supervised) or `stateloom-setup` (foreground) first — this skill adds
nothing but reachability.

---

## The one decision that governs the rest

**Both endpoints, or neither is worth doing.**

The canvas is a browser app. It hands each visitor a bridge URL and *that visitor's
browser* dials it — not the machine hosting the canvas. Publish only the canvas and a
remote viewer gets a board that renders beautifully and then never moves: their browser
dials their own `127.0.0.1:4599` into silence. No error in any log, on either side. The
hub has to travel with the canvas.

Three consequences worth knowing before you type anything:

- **Both legs must be HTTPS.** An HTTPS canvas cannot open a plain-HTTP socket — browsers
  block it as mixed active content. So "just bind the hub to the tailnet IP" does not
  work; the hub needs the same TLS the Service provides.
- **Different port means different origin**, so the hub is cross-origin from the canvas.
  This is already handled: the hub enables CORS unconditionally and answers
  `Access-Control-Allow-Origin: *`. Nothing to configure.
- **You cannot merge them onto one port with a path.** See the trap below.

### Trap — `--set-path` is accepted and silently dropped

Tailscale **Services route by port only**. `tailscale serve --service=... --set-path=/socket.io`
is accepted on the command line, prints its usual success banner, and then does nothing:
`serve get-config --service=...` still shows only the root endpoint. Path mounting is a
node-serve feature, not a service one. Two endpoints is the supported shape — reach for a
local origin-splitting proxy only if you have a reason the two-endpoint form cannot serve,
and know that it costs you a process, a unit, and a third port.

---

## Step 1 — Preconditions

```bash
tailscale version                       # 1.86 or newer for named Services
tailscale status                        # must be authenticated
ss -tln | grep -E '4598|4599'           # both halves of the loom listening
```

**The host must be a tagged node.** A device authenticated only as a user cannot host a
Service, and the failure is quiet — it simply never becomes available.

```bash
tailscale status --json | grep -A3 '"Tags"'
```

No tags means: tag the machine (e.g. `tag:server`) in your ACL policy before continuing.

---

## Step 2 — Define the Service in the admin console FIRST

Human step, and the order is load-bearing. Advertising a Service that has not been defined
leaves a **stuck advertisement**: the host never appears as a pending host to approve, and
the clean-up is a `serve clear` plus a fresh registration.

In the Tailscale admin console → Services → define a Service:

- **Name:** a single short word — it becomes the hostname
- **Ports:** `tcp:443` *and* `tcp:4599`

`443`, not `4598`: the port listed is the one the *Service* answers on, not the one it
forwards to.

---

## Step 3 — Provision the certificate

```bash
SERVICE=<service>; TAILNET=<your-tailnet>.ts.net
DOMAIN="${SERVICE}.${TAILNET}"
CERT_DIR="$HOME/.stateloom/cert"; mkdir -p "$CERT_DIR"

tailscale cert --cert-file "$CERT_DIR/$DOMAIN.crt" \
               --key-file  "$CERT_DIR/$DOMAIN.key" "$DOMAIN"
```

Failing here before approval is expected, not an error — re-run after Step 5.

---

## Step 4 — Register both endpoints, then advertise

Host-side enrollment is **two commands**, and skipping the second leaves the host enrolled
but not advertising:

```bash
tailscale serve --service=svc:${SERVICE} --https=443  "127.0.0.1:4598"    # canvas
tailscale serve --service=svc:${SERVICE} --https=4599 "127.0.0.1:4599"    # hub
tailscale serve advertise svc:${SERVICE}
```

**Verify:**

```bash
tailscale serve get-config --service=svc:${SERVICE}     # BOTH endpoints must appear
```

A message about admin approval being required is *confirmation the host enrolled*, not a
failure.

### Make it survive a reboot

Wrap those three lines (plus a `tailscale cert` refresh) in a script and run it from a
`systemd --user` oneshot with `RemainAfterExit=yes`, `After=tailscaled.service`, and
`ExecStop=tailscale serve clear svc:<service>`. Pair it with a weekly `OnCalendar=weekly`
timer that re-runs `tailscale cert` so the certificate never quietly expires. Enable
lingering (`loginctl enable-linger "$USER"`) or none of it starts at boot.

---

## Step 5 — Approve the host

Human step, console only: Services → your service → Service hosts → **Approve** the
machine. This click is the actual flip; everything before it is preparation.

---

## Step 6 — Tell the canvas its public origin

The last step, and the one whose absence produces the silent failure from the top of this
skill. The canvas must hand visitors the **tailnet** hub URL, not a loopback one.

The published canvas resolves this **at runtime**, from the process serving it — which is
what lets a prebuilt bundle carry nobody's URL. So this is a restart, never a rebuild:

```bash
stateloom-web --port 4598 --doc /absolute/path/to/board.smdf.json \
              --bridge https://<service>.<your-tailnet>.ts.net:4599
```

Running as a service (`stateloom-service`), change `--bridge` in
`stateloom-canvas.service`, then `systemctl --user daemon-reload && systemctl --user restart stateloom-canvas`.

**Verify — this is the check that catches the silent failure:**

```bash
curl -sS http://127.0.0.1:4598/api/config
# → {"bridgeUrl":"https://<service>.<your-tailnet>.ts.net:4599", …}
```

If that still says `127.0.0.1`, every remote viewer sees a frozen board.

The host is itself on the tailnet, so this one origin works locally *and* remotely — there
is no second configuration for "local use".

---

## Verify the whole path

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<service>.<your-tailnet>.ts.net/
curl -sS 'https://<service>.<your-tailnet>.ts.net:4599/socket.io/?EIO=4&transport=polling'
```

A `0{"sid":…,"upgrades":["websocket"]…}` line from the second means the loom breathes over
the tailnet. Then open the canvas from a *different* device and drag a box — someone
watching on the first device should see it move.

---

## Diagnosing

| Symptom | Cause | Move |
|---|---|---|
| Board renders remotely, never moves | canvas is handing out a loopback bridge URL | `curl /api/config`; fix `--bridge`, restart the canvas |
| Console shows a mixed-content block | hub reached over plain HTTP from an HTTPS canvas | publish the hub endpoint too; never use the raw tailnet IP |
| Host never appears to approve | advertised before the Service was defined | `tailscale serve clear svc:<service>`, define it in the console, register again |
| Service exists, nothing answers | `advertise` never ran, or the host is unapproved | re-run `serve advertise`, then approve in the console |
| Worked for months, then stopped | certificate expired | re-run `tailscale cert`; add the weekly renewal timer |
| `--set-path` "succeeded" but nothing routes | Services route by port only | use two endpoints |
| Canvas loads, hub 404s | only one endpoint registered | `serve get-config` must list both |

---

## Related

- `stateloom-service` — the supervised local pair this publishes, and how to upgrade it
- `stateloom-live-loop` — what travels over the wire once remote peers can reach the hub
- Tailscale documentation on Services and their configuration file — read it each time;
  this surface changes faster than a skill file does
