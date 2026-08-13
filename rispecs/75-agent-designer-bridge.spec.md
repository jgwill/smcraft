# Agent ↔ Designer Bridge — Live Sync & Codegen Pipeline

> RISE Framework Specification
> References: Spec 73 (MCP Server), Spec 74 (Web Designer), Spec 76 (RISE rispec generator)
> Origin: Ceremony `65438273-888a-487d-855d-ede6e7a1ee6f` (2026-03-15)
> Revised: Issue #10 / PR #11 (2026-04-16) — implementation landed, architecture revised
> Artifacts: `stcevaluations/65438273-888a-487d-855d-ede6e7a1ee6f/`, `docs/audits/issue-10-mcp-web-bridge-design.md`

**Spec ID**: 75
**Version**: 2.0
**Status**: § 1 and § 4 **implemented**; § 2 and § 3 still aspirational

## Creative Intent

**What This Enables Users to Create:**
A fluid design loop where the human converses with an LLM agent about state machine design, the agent manipulates the definition via MCP tools, and a WebUI reflects changes — while the human edits visually in the WebUI and those changes flow back to the agent's session. The state machine becomes the shared artefact between ceremony, code, and canvas.

**Desired Outcome:**
The agent, the WebUI, and the filesystem form a single coherent design surface. Changes flow in all directions. The definition is the bridge.

## Current Reality (post-implementation)

1. **Agent and WebUI now share a single file.** Both the MCP server and the Next.js web app read/write one JSON document on disk, selected by the `SMCRAFT_PROJECT_FILE` env var (default: `./statemachine.smdf.json`). Changes from either surface are observed by the other within one fs-watch tick.

2. **Codegen in the WebUI works** for Python via `smcg`; the TS path is stubbed. The `📥 Download` button still exports the current definition as a file (browser-side), but **save now writes to disk** via `PUT /api/file`.

3. **No scaffold step yet.** `generate_code` produces a single source file. `pyproject.toml`, `package.json`, and entrypoints are still not generated.

4. **New RISE terminus.** `generate_rispec` (see Spec 76) emits a RISE framework rispec from the current SMDF — giving the design loop an `E` (Exportation) step beyond code.

## Specification

### 1. Live Agent ↔ WebUI Sync — **File-backed SSE (implemented)**

**Architecture (actual):**
```
┌──────────────┐   stdio    ┌──────────────┐  read/write   ┌────────────────────────┐   read/write   ┌──────────────┐
│  LLM Agent   │◄──────────►│  mcp-smcraft │◄─────────────►│ SMCRAFT_PROJECT_FILE   │◄──────────────►│   Web UI     │
│ (Claude etc) │ MCP proto  │  (Node.js)   │  readDef()/   │   .smdf.json on disk   │  /api/file     │ (Next.js)    │
└──────────────┘            └──────────────┘  writeDef()   └──────────┬─────────────┘  GET/PUT       └───────┬──────┘
                                                                      │                                       ▲
                                                                      │ fs.watch(path)                        │
                                                                      ▼                                       │
                                                              ┌─────────────────┐      text/event-stream      │
                                                              │ /api/watch SSE  │─────────────────────────────┘
                                                              └─────────────────┘
```

**Contract:**
- **One file, one truth.** Both surfaces resolve `SMCRAFT_PROJECT_FILE` (absolute path). No in-memory duplicate.
- **MCP tools** call `readDef()` before mutation and `writeDef()` after — every handler is atomic against the file.
- **Web API:**
  - `GET /api/file` → `{ path, content, mtime, exists }`
  - `PUT /api/file` → body `{ content }` → `{ path, mtime, ok: true }`
  - `GET /api/watch` → SSE stream, emits `event: change` with `{ mtime }` on every fs.watch tick
- **Web store:** `BridgeProvider` hydrates from `/api/file` on mount and re-hydrates on each `change` event unless the local buffer is dirty (in which case status becomes `remote-changed`).
- **Conflict policy:** **last-write-wins**, with a user-visible toast (`↻ remote changed`) when remote mtime advances while the local buffer is dirty. No automatic 3-way merge.

**Why SSE, not socket.io?**
- Unidirectional push is sufficient: writes are already HTTP PUT; we only need to notify of remote change.
- No extra ws server, no extra dependency, no dual transport to reason about.
- fs.watch on the project file is the single source of change-detection truth.

### 2. `launch_designer` MCP tool — **future work**

Still proposed as in v1.0: opens the WebUI in the user's browser after ensuring the server is running. Deferred until the bridge has been used in more sessions; current practice is `cd web && npm run dev` by hand.

### 3. `generate_to_file` + scaffold — **future work**

`generate_code` still returns text to the conversation. Writing to `{output_dir}` with optional `pyproject.toml`/`package.json` scaffold remains on the backlog. The "Generate" button in the WebUI now succeeds for Python (returning code text into the preview panel) but does not yet write files.

### 4. Definition Persistence — **implemented (as the bridge itself)**

Persistence is no longer a feature layered *on top* of an in-memory store — it **is** the store. Every MCP tool handler writes the full definition back to `SMCRAFT_PROJECT_FILE` after mutation. "Recovery on startup" is trivially `readDef()` on the first tool call.

## Structural Tension Chart

| # | Current Reality (2026-04-16) | Desired Outcome | Resolution |
|---|------------------------------|-----------------|------------|
| 1 | ~~Agent and WebUI are disconnected silos~~ **Shared file + SSE push** | Changes propagate in both directions without manual export | ✅ File-backed bridge + fs.watch SSE |
| 2 | Agent cannot launch the WebUI | Agent opens designer as part of workflow | `launch_designer` MCP tool (future) |
| 3 | Codegen returns text, not files | Generate writes runnable files to disk | `generate_to_file` MCP tool (future) |
| 4 | Generated code has no project scaffold | Runnable project with dependencies + entrypoint | `scaffold: true` option on `generate_to_file` (future) |
| 5 | ~~Definition lost on server restart~~ **Disk is the session** | Design survives any restart | ✅ File-backed store |
| 6 | Design loop has no "Exportation" terminus beyond code | Agent can emit RISE rispecs from any SMDF | ✅ `generate_rispec` (Spec 76) |

## Implementation Status

1. ✅ **File-backed bridge** (`SMCRAFT_PROJECT_FILE` + `/api/file` + `/api/watch` SSE + `BridgeProvider`)
2. ✅ **MCP tools read-from/write-to disk** (every handler in `mcp/src/server.ts`)
3. ✅ **`generate_rispec`** (see Spec 76)
4. ⬜ `generate_to_file` with real `smcg` invocation and `output_dir`
5. ⬜ `launch_designer` quality-of-life tool
6. ⬜ Scaffold generation (`pyproject.toml` / `package.json` + entrypoint)
7. ⬜ TypeScript codegen parity with Python (`smcg` is Python-only today)

## Dependencies

- **Spec 70 (SMDF):** Definition format — the single document on disk
- **Spec 72 (Code Generator):** `smcg` CLI invoked by `/api/generate` (Python path)
- **Spec 73 (MCP Server):** Tool handlers now read/write the shared file instead of in-memory state
- **Spec 74 (Web Designer):** `BridgeProvider` + `Toolbar` disk/reload/rispec buttons + remote status badges
- **Spec 76 (RISE rispec generator):** Adds the `E` step to the design loop
