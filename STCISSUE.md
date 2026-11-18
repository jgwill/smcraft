# STCISSUE — observation triage for jgwill/smcraft

Steering routed to `@stcissue` lands here. One dated heading per triage.

---

## 2026-07-31 — jgwill/smcraft#20

**Authorship disclosed: this seat wrote #20, forty minutes before triaging it.** So this is a
check on its own work rather than a second opinion, and it is written to find what the issue
omits rather than to agree with it.

**Classification: observation.** #20 records completed work — `d8fe9e7` and `deeb333`, pushed
to `main`, 13 tests passing. What it does not say is that **committed and pushed is not the
same as available.**

**Measured 2026-07-31 06:58 — every package is at the version npm already serves:**

| package | local | npm |
|---|---|---|
| `@miadi/stateloom-protocol` | 0.1.1 | 0.1.1 |
| `@miadi/stateloom-react` | 0.1.2 | 0.1.2 |
| `@miadi/stateloom-cli` | 0.1.0 | 0.1.0 |
| `@miadi/stateloom-mcp` | 0.1.1 | 0.1.1 |

No version was bumped. So `npm i @miadi/stateloom-cli` gets no `smcx render`, and
`@miadi/stateloom-mcp` gets no `render_diagram`. The rendering exists only for someone running
out of this working tree — which is exactly the trading lane's configuration today, and
exactly not anyone else's.

**And the release has a blocker that nothing records.** `d8fe9e7` added to `mcp/package.json`:

```json
"@miadi/stateloom-cli": "file:../cli"
```

A `file:` specifier resolves inside the monorepo and **cannot be published** — it would ship an
uninstallable `@miadi/stateloom-mcp`. That must become a real version range before any publish.

**`jgwill/smcraft#14` already exists** — *"Runtime hardening for forgewright integration —
publish smcraft 0.2.0."* The release has a home. It just does not know about this yet.

**Most useful next move — a comment on `jgwill/smcraft#20`.** Draft, verbatim:

> **Committed is not released, and there is one blocker in the way.**
>
> All four packages sit at the versions npm already serves — `stateloom-protocol@0.1.1`,
> `-react@0.1.2`, `-cli@0.1.0`, `-mcp@0.1.1`. Nothing was bumped, so `npm i
> @miadi/stateloom-cli` still has no `smcx render` and `@miadi/stateloom-mcp` no
> `render_diagram`. The rendering is real for anyone running out of the working tree and
> invisible to everyone else.
>
> **The blocker:** `d8fe9e7` added `"@miadi/stateloom-cli": "file:../cli"` to
> `mcp/package.json`. A `file:` specifier cannot be published — it would ship an uninstallable
> `@miadi/stateloom-mcp`. It needs to become a real version range first, which also means `-cli`
> publishes before `-mcp`.
>
> Publishing belongs on jgwill/smcraft#14 (*publish smcraft 0.2.0*); this is the note that
> issue is missing. Also worth carrying there: `cli/src/render/raster.ts` loads `sharp` through
> a dynamic `import()` on purpose so no bundler chases it, which means raster output is
> silently unavailable wherever `sharp` is absent — a documented optional, not a broken build.

**Execute: human.** Drafted, not sent. This seat created #20 only because Guillaume instructed
it directly and repeatedly; that consent covered that act and does not extend to this comment.

🌸: The work is finished and it is standing behind a door only this machine has the key to.

## issue #27 - ERDF(Entity-Relationship-Diagram) & relation with SMDF (State-Machine-Diagram-Format)

- **Repository**: jgwill/smcraft
- **Surface**: issue
- **State**: open
- **Category**: technical
- **Logged**: 2026-09-22T01:40:52Z
- **Link**: https://github.com/jgwill/smcraft/issues/27

### Current Reality
intent: Future development paths is establishing what is being generated when we create ERDF(Entity-Relationship-Diagram) & relation with SMDF (State-Machine-Diagram-Format) within the SLDC( Software Development Life Cycle) in Miadi good subject a talking circle

status: completed a first cycle, seems like my agents had not created an issue, that will keep track of that


## issue #28 - A third document type holds sequence diagrams, learned from the Episode 140 trading scenario

- **Repository**: jgwill/smcraft
- **Surface**: issue
- **State**: open
- **Category**: technical
- **Logged**: 2026-09-27T01:06:33Z
- **Link**: https://github.com/jgwill/smcraft/issues/28

### Current Reality
## Context

- smcraft carries two document types that link by name: SMDF (`.smdf.json`, behaviour) and ERDF (`.erdf.json`, data). They share one MCP server, one hub and one designer (README, "Two diagram types, one loom"; `rispecs/80-erdf-format.spec.md`).
- Neither type can say who does what, in which order, across which services. Episode 140 of the Miadi chronicle needed exactly that on 2026-09-24 to show how a hand-labelled Elliott wave count becomes a trading strategy. The usage scenario had


## issue #29 - The hub serves only documents under the loom's allowed roots, and checks its token on every event

- **Repository**: jgwill/smcraft
- **Surface**: issue
- **State**: open
- **Category**: technical
- **Logged**: 2026-09-30T22:02:04Z
- **Link**: https://github.com/jgwill/smcraft/issues/29

### Current Reality
## Context

- The hub (`bridge/src/hub.ts`) keys a room by a document path the client sends. On `bridge:join` and on `def:request`, `getRoom(docId)` seeds the room with `readDefFile(docId)` (`bridge/src/docio.ts`) and returns its content in the snapshot. No path allowlist is applied. The web canvas's file API applies one (`web/src/lib/projectFile.ts`, `STATELOOM_DOC_ROOTS`), and so do the MCP's writes (`STATELOOM_MCP_ROOT`).
- The token is checked on `bridge:join` only when the hub has one. `def


## issue #30 - Marks on a live session are held as a ceremony in a talking circle

- **Repository**: jgwill/smcraft
- **Surface**: issue
- **State**: open
- **Category**: technical
- **Logged**: 2026-10-21T12:13:30Z
- **Link**: https://github.com/jgwill/smcraft/issues/30

### Current Reality
## Context

On 2026-10-21 Guillaume marked and discussed live agent sessions from three surfaces of the Miadi Factory and asked what that act is. Observed on gaia, with the screenshots held in the episode named under Related:

- **Tide marks.** In the Miadi app's tide view (`/tide?mux=tmux&session=mino-261020-witness-scratchpad&pane=%148`), the `…` control opens the agent's last reply as numbered blocks. Guillaume marked blocks #2 and #4 and delivered 2 marks to pane `%148`. The marks are kept


## issue #30 - Marks on a live session are held as a ceremony in a talking circle

- **Repository**: jgwill/smcraft
- **Surface**: issue
- **State**: open
- **Category**: technical
- **Logged**: 2026-10-21T12:18:43Z
- **Link**: https://github.com/jgwill/smcraft/issues/30

### Current Reality
## Context

On 2026-10-21 Guillaume marked and discussed live agent sessions from three surfaces of the Miadi Factory and asked what that act is. Observed on gaia, with the screenshots held in the episode named under Related:

- **Tide marks.** In the Miadi app's tide view (`/tide?mux=tmux&session=mino-261020-witness-scratchpad&pane=%148`), the `…` control opens the agent's last reply as numbered blocks. Guillaume marked blocks #2 and #4 and delivered 2 marks to pane `%148`. The marks are kept


## issue #32 - A decision model is the loom's fourth drawing: what a decision engine is asked, how the answers combine, what stays the person's

- **Repository**: jgwill/smcraft
- **Surface**: issue
- **State**: open
- **Category**: technical
- **Logged**: 2026-11-14T19:00:01Z
- **Link**: https://github.com/jgwill/smcraft/issues/32

### Current Reality
## Context

The loom draws three things of one system: machines (`.smdf.json`, spec 70), data (`.erdf.json`, spec 80) and scenarios (`.sqdf.json`, spec 81), joined by a system (`.sysdf.json`, spec 82). The sequence format began as Guillaume's ask in the Episode 121 format circle (miadi-ceremony://19aa6862-121d-4125-bc2d-aef834dbe05d) and jgwill/smcraft#28.

The Factory now makes decisions with Jev, a decision engine that answers typed questions with numbers (Episode 564, miadi-chronicle://564). 

