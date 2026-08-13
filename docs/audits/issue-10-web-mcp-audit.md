# Issue #10 — Web + MCP Audit

Branch: `10-web-mcp-audit-and-boot` · Issue: jgwill/smcraft#10
PDE: `.pde/2604151042--bd032999-1f74-4bb6-a93c-6f9d959c7c26/`

## What I exercised

Booted `web/` (Next.js 16 + Turbopack), connected via Playwright, walked: load → validate (V001 surfaced) → add event → re-validate (clean) → generate Python → generate TypeScript. Inspected `mcp/src/server.ts` and `web/src/app/api/generate/route.ts`.

Screenshots: `./issue-10-screenshots/smcraft-{01..05}-*.png`.

## Current capability matrix

| Surface | Status | Notes |
|---|---|---|
| `mcp/` server (11 tools) | builds & loads, runtime not exercised end-to-end this pass | tools: create/add/remove state, add event/transition, validate, generate (python\|typescript), get/load definition, list states/events; resource `smcraft://definition`; prompt `design-state-machine` |
| `web/` Next.js designer | boots after fix, full single-user flow works | toolbar, canvas (states), tabs (Properties/Events/Settings/Errors), code preview, JSON load/save, undo/redo |
| Python codegen path | works end-to-end via real `smcg` CLI (PATH: `/home/jgi/anaconda3/bin/smcg`) | output uses `smcraft.runtime` (Context, State, StateKind, TransitionHelper) |
| TypeScript codegen path | **broken** at the CLI layer | `smcg` only accepts `-l python`; web API has no fallback, returns 500 + JSON dump; `mcp/` server has an inline TS fallback in `server.ts` but it diverges from the smcg-generated Python in shape |
| `ts/` runtime parity with `py/` | not exercised; presence-only audit | both packages exist; whether they accept the same SMDF JSON wasn't tested |
| Two-agent collaborative session | **not yet possible** | mcp server holds state in a single `let currentDefinition` module variable (`mcp/src/server.ts:70`); no shared store between agents; no broadcast/subscribe surface; web has no link to the mcp server, only the local `/api/generate` route |
| Visual feedback during MCP edits | **not wired** | web reads/writes its own zustand store; no MCP→web bridge; no SSE/WebSocket; web's only backend touch is `POST /api/generate` |

## Real bugs found

1. **`web/next.config.ts` had a hard-coded turbopack root `/b/trading/smcraft/web`.** Caused `Invalid distDirRoot: ".next"` panic on every other host. **Fixed on this branch** — replaced with `__dirname` so it boots wherever the repo lives.
2. **TypeScript codegen returns HTTP 500.** `smcg --help` shows `-l {python}` only. Web `/api/generate` execs `smcg ... -l typescript` unconditionally and surfaces the CLI error in the preview pane. (Not fixed; flagged for decision below.)
3. **Code preview heading hard-coded** `"Generated Definition (JSON)"` even when body is Python or a smcg error. Cosmetic; should reflect the selected language. (Not fixed.)
4. **`EventsPanel` React key warning** on first event add (`Each child in a list should have a unique "key" prop`). Console-only; functional. (Not fixed.)

## Implications for issue #10's desired state

The four packages exist, but the **collaborative + visual + pre-codegen loop has never been walked end to end** — confirmed. Specifically:

### Blocking the two-agent loop

- mcp server's in-memory `currentDefinition` is per-process and per-stdio-transport. Two agents = two MCP processes = two unrelated definitions. **A shared store is the first real piece of work.**
- No transport from mcp ↔ web exists today. The web designer is a self-contained editor; the mcp server is a self-contained CLI. **A bridge (file watcher, HTTP endpoint on the web side, or websocket) is the second real piece.**

### Blocking the pre-codegen flow

- `smcg` only emits Python. Modeling the miaco chain in smcraft and then generating TypeScript runtime stubs is currently impossible via the CLI path. Either:
  - Patch `smcg` to add TypeScript output (upstream change in `py/smcraft`'s smcg subpackage), **or**
  - Make `mcp/server.ts`'s inline TS fallback the canonical TS generator and stop pretending smcg will do it, **or**
  - Drop TypeScript from the language picker until smcg supports it.
- No RISE Spec phase exists in either the MCP tool surface or the web pipeline. Adding it requires deciding (per issue #10 ambiguities) whether RISE is an smcraft state/transition or an external orchestration step.

### Runtime upgrade signals

- `ts/` and `py/` were not exercised against the miaco chain — that requires the chain to be modeled first (an issue #10 action step still pending). No immediate upgrade signal beyond "smcg lacks TS output".

## Recommended next moves (post-merge)

1. Decide TS codegen direction (patch smcg vs. promote inline fallback vs. drop UI option).
2. Design the mcp-shared-store + web-bridge so two agents and one human see the same definition.
3. Model `/src/mia-code/miaco` as an SMDF artefact through the new collaborative session.
4. After (3), decide RISE placement.

## Files in this PR

- `web/next.config.ts` — fix hardcoded turbopack root (the blocker that prevented boot)
- `docs/audits/issue-10-web-mcp-audit.md` — this report
- `docs/audits/issue-10-screenshots/` — Playwright captures of each step
