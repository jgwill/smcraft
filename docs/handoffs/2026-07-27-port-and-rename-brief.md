# Lane brief — the loom's pair of ports, and the rename finished (2026-07-27)

From William's review of the 2026-07-26 work. Two items, both yours
(`miadi-stateloom-handoff-lane`, pane `w1Y:pB`). Hub on 4599 stays untouched,
as always.

## A — Move the web canvas off 3000 → 4598

- `web/package.json`: `"start": "next start -p ${PORT:-4598}"`, and the same
  port default on `dev`.
- `scripts/live-loop.sh`: add `STATELOOM_WEB_PORT=4598` beside the existing
  `SMCRAFT_BRIDGE_PORT=4599` and have the web target honor it.
- Update any `localhost:3000` references in docs/specs this repo owns.
- Rebuild, restart the web **in its home pane `w1Y:p5`** (kill the old 3000
  server there first; it is yours to restart, nothing else is).
- Prove: cold context → `http://localhost:4598` renders the machine.
  4598/4599 sit together as the loom's pair.

## B — Finish the rename, with a working alias

- `mcp/package.json`: `smcraft-mcp` → `@miadi/stateloom-mcp` (bump to 0.1.1,
  publish — npm auth is live; a `npm deprecate` notice on `smcraft-mcp`
  pointing to the new name is NICE, not MUST).
- `web/package.json`: `"name": "web"` → `"stateloom-web"` (stays `private`).
- Env vars: every `SMCRAFT_*` read gains a `STATELOOM_*` twin — code reads
  `STATELOOM_*` first, falls back to `SMCRAFT_*`. **`SMCRAFT_PROJECT_FILE`
  must keep working** — it is baked into the live MCP registration; flipping
  it blind breaks the loop. Same alias rule for `SMCRAFT_BRIDGE_URL` /
  `_PORT` / `_HOST` wherever read.
- Update README / rispecs / llms.txt mentions you touch.

## Discipline

- Both test suites green before any commit; add coverage for the env alias
  fallback.
- Commit only files you edited; push `main`.
- Worktrees, if any: `/a/ws/<owner>/<repo>/<branch|issue|PR>` — never `/tmp`,
  never `.worktrees/`.
- Append a dated report to
  `docs/handoffs/2026-07-26-stateloom-live-canvas-chronicle.md` § Lane report,
  then go idle for the witness.
