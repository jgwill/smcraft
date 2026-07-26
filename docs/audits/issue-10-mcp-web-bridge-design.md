# mcp-smcraft ↔ web bridge — design

Branch: `10-web-mcp-audit-and-boot` · Issue: jgwill/smcraft#10 · Task #10

## Why

Today the web designer and the mcp server are two disconnected universes:

- **web/**: Save = browser download, Load = file picker. Edits live in zustand only. No backend persistence.
- **mcp/**: Holds `let currentDefinition: Definition | null` in process memory (`mcp/src/server.ts:70`). One stdio process = one in-memory definition. Two agents = two unrelated states.
- **No shared artefact** between them. An LLM editing via mcp tools and a human editing in the canvas cannot see each other.

The user's stated goal — "use this tool within a ceremony to design parts of the system as state machines" — requires a single source of truth that both surfaces watch.

## Desired state

One on-disk file (`*.smdf.json`) is the source of truth. The web canvas and the mcp server both read from and write to it. Edits on either side propagate to the other within ~1s without page reload.

## Shape

```
                 ┌──────────────────────┐
                 │  *.smdf.json on disk │ ← source of truth
                 └──────────┬───────────┘
                            │ fs read/write + watch
            ┌───────────────┴───────────────┐
            │                               │
   ┌────────▼─────────┐           ┌─────────▼────────┐
   │  web (Next.js)   │           │  mcp server      │
   │  ──────────────  │           │  ──────────────  │
   │  POST /api/file  │  ←──────  │  read/write same │
   │  GET  /api/file  │           │  file path       │
   │  GET  /api/watch │  (SSE)    │                  │
   │   ↑              │           │  watches file ←  │
   │   │ zustand sync │           │  reloads in-mem  │
   │   └──────────────│           │  on external chg │
   └──────────────────┘           └──────────────────┘
```

Both processes treat the file as the truth. The in-memory state in each is a **cache** that gets invalidated by file-watch events.

## Bindings

### `SMCRAFT_PROJECT_FILE` env var

Both processes resolve the same path from the same env var:

- `web/`: read at server start, exposed via `/api/file` routes
- `mcp/`: read at server start, replaces the `currentDefinition` module variable

Default: `./statemachine.smdf.json` relative to cwd.

This is the simplest possible "shared store" — no database, no broker, no extra service. Just a file with two watchers.

## Web changes

### New: `web/src/app/api/file/route.ts`

```ts
GET  /api/file        → returns { content: string, mtime: number, path: string }
PUT  /api/file        → writes body { content: string }, returns { mtime: number }
```

Resolves path from `process.env.SMCRAFT_PROJECT_FILE` (server-only).

### New: `web/src/app/api/watch/route.ts`

Server-Sent Events stream. On boot, opens an `fs.watch` on the project file. Each change → emits `event: change\ndata: { mtime }\n\n`. Web client subscribes via `EventSource`, refetches `/api/file` on each event, calls `loadFromJson` if mtime is newer than what zustand has.

### Toolbar wiring (`web/src/components/Toolbar.tsx`)

- 💾 Save (`handleSave`): replace the `Blob`/`a.download` dance with `fetch('/api/file', { method: 'PUT', body: JSON.stringify({ content: exportJson() }) })`. Browser download stays available behind a separate "📥 Download" button (or removed entirely once bridge is trusted).
- 📂 Load (`handleFileChange`): keep file-picker for ad-hoc files, but also add 🔄 Reload that calls `GET /api/file`.

### Store changes (`web/src/store/useDesignerStore.ts`)

Add:
- `remoteMtime: number | null` — last mtime we reconciled with disk.
- `setFromRemote(content, mtime)` — like `loadFromJson` but doesn't reset `dirty` flag if local has unsaved diffs (conflict UX deferred).

### Boot wiring

In `web/src/app/page.tsx` (or a new `BridgeProvider`):
- On mount: `GET /api/file` → `setFromRemote`.
- Open `EventSource('/api/watch')`. On message: `GET /api/file` → reconcile.

## MCP changes

### Replace in-memory `currentDefinition` with file-backed accessor

`mcp/src/server.ts:70` becomes:

```ts
const FILE = process.env.SMCRAFT_PROJECT_FILE ?? "./statemachine.smdf.json";

function readDef(): Definition | null {
  if (!existsSync(FILE)) return null;
  return JSON.parse(readFileSync(FILE, "utf8"));
}
function writeDef(def: Definition) {
  writeFileSync(FILE, JSON.stringify(def, null, 2));
}
```

Every tool that reads `currentDefinition` calls `readDef()`. Every tool that mutates writes via `writeDef(newDef)`. No file-watch needed inside mcp itself — each tool call re-reads.

### Optional: `set_project_file` mcp tool

Allows an agent to switch the working file mid-session. Validates path, updates the env-var-derived FILE constant for that process. (Skip in v1 if the env var is enough.)

## Conflict policy (v1)

**Last write wins.** When both sides edit simultaneously, the second write overwrites the first. The web client shows a small "↻ remote changed" toast when SSE fires while `dirty=true`, but does not auto-merge. Real merge UX is a separate, larger piece of work — out of scope.

## What this does NOT do (yet)

- No multi-user auth or per-user file scoping. Single project, single file.
- No schema migration. Both sides assume the same SMDF shape.
- No transport from mcp → web push. Web uses fs.watch on its own end; mcp just writes. (Web's fs.watch sees mcp's writes — that's the link.)
- No history/undo across processes. Web zustand undo stack is local-only.

## Test plan

1. Start web with `SMCRAFT_PROJECT_FILE=/tmp/test.smdf.json npm run dev`.
2. Start mcp with same env var via stdio.
3. Web: load `examples/miaco-pde-sample.smdf.json` → save. Verify file at `/tmp/test.smdf.json`.
4. mcp: call `add_state` for `NewState`. Verify file updated.
5. Within ~1s, web canvas shows `NewState`.
6. Web: drag a state. Save. mcp: `get_definition` reflects the move.
7. Both sides edit at once → last writer wins, toast shows on web side.

## Implementation order (tasks #11)

1. `web/src/app/api/file/route.ts` — GET + PUT
2. `web/src/app/api/watch/route.ts` — SSE
3. Wire Toolbar Save → PUT
4. Wire boot fetch + EventSource subscriber
5. mcp: replace `currentDefinition` with `readDef`/`writeDef`
6. End-to-end test per above

## Files touched

- `web/src/app/api/file/route.ts` (new, ~40 lines)
- `web/src/app/api/watch/route.ts` (new, ~30 lines)
- `web/src/components/Toolbar.tsx` (~10 lines changed)
- `web/src/store/useDesignerStore.ts` (~20 lines added)
- `web/src/app/page.tsx` (~15 lines added)
- `mcp/src/server.ts` (~30 lines changed — module-level state → file accessor)

Total ~145 lines. Small enough to land in a single follow-up PR.
