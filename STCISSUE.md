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
