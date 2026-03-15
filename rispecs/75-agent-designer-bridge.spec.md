# Agent ↔ Designer Bridge — Live Sync & Codegen Pipeline

> RISE Framework Specification
> References: Spec 73 (MCP Server), Spec 74 (Web Designer)
> Origin: Ceremony `65438273-888a-487d-855d-ede6e7a1ee6f` (2026-03-15)
> Artifacts: `stcevaluations/65438273-888a-487d-855d-ede6e7a1ee6f/`

**Spec ID**: 75
**Version**: 1.0
**Source**: Evaluation ceremony — first-contact skill-building with smcraft-mcp

## Creative Intent

**What This Enables Users to Create:**
A fluid design loop where the human converses with an LLM agent about state machine design, the agent manipulates the definition via MCP tools, and a WebUI reflects changes in real-time — while the human can also edit visually in the WebUI and have those changes flow back to the agent's session. The codegen output lands as files on disk, not clipboard text.

**Desired Outcome:**
The agent, the WebUI, and the filesystem form a single coherent design surface. Changes flow in all directions. Generated code is written to the project, ready to run.

## Current Reality

From ceremony evaluation:

1. **Agent and WebUI are disconnected.** The MCP server holds one in-memory definition. The WebUI loads from a static JSON file. There is no live link between them. The agent cannot launch the WebUI. The user must manually export JSON → open in browser → manually re-import.

2. **Codegen is broken in the WebUI.** The "Generate" button shows "Code generation failed: Unknown error" and falls back to displaying the JSON definition with a "Copy to Clipboard" button. The MCP `generate_code` tool works but outputs text to the agent conversation — it does not write files.

3. **No scaffold step.** Generated code imports `smcraft.runtime` but no `pyproject.toml`, `package.json`, or entrypoint is created. The user receives library code without application code.

## Specification

### 1. Live Agent ↔ WebUI Sync (Socket.IO)

**Architecture:**
```
┌──────────────┐     stdio      ┌──────────────┐    socket.io     ┌──────────────┐
│  LLM Agent   │◄──────────────►│  MCP Server  │◄────────────────►│   Web UI     │
│ (Claude etc) │   MCP protocol │  (Node.js)   │   ws://3000/ws   │ (Next.js)    │
└──────────────┘                └──────┬───────┘                  └──────────────┘
                                       │
                                       ▼
                                  ┌──────────┐
                                  │ File I/O │
                                  │ (codegen)│
                                  └──────────┘
```

**Events (Server → WebUI):**
- `definition:updated` — full definition JSON after any MCP tool mutation
- `validation:result` — validation errors/success after `validate_definition`
- `codegen:complete` — notification that code was written to disk

**Events (WebUI → Server):**
- `definition:patch` — delta from user edits (state added, transition wired, property changed)
- `codegen:request` — user clicks Generate in UI

**Behavior:**
- MCP server is the single source of truth for the definition
- WebUI connects via socket.io on startup, receives current definition
- Every MCP tool call that mutates the definition emits `definition:updated`
- Every WebUI edit sends `definition:patch`, server applies it, emits `definition:updated` back (confirming)
- Agent sees changes via `get_definition` or a new `subscribe_changes` tool

### 2. New MCP Tool: `launch_designer`

```typescript
{
  name: "launch_designer",
  description: "Open the WebUI designer in the user's browser with the current definition",
  parameters: {
    port?: number  // default 3000
  }
}
```

**Behavior:**
1. Start the web server if not already running (or verify it's running)
2. Push current in-memory definition to the WebUI via socket.io
3. Open `http://localhost:{port}` in the user's default browser
4. Return confirmation to the agent

This lets the agent say: "I've designed the state machine — let me open the visual designer so you can see it and make adjustments."

### 3. Codegen Pipeline — Files, Not Clipboard

**New MCP tool: `generate_to_file`**

```typescript
{
  name: "generate_to_file",
  description: "Generate code from current definition and write to filesystem",
  parameters: {
    language: "python" | "typescript",
    output_dir: string,        // where to write the generated file
    scaffold?: boolean         // if true, also generate pyproject.toml/package.json + entrypoint
  }
}
```

**Behavior:**
1. Validate definition first (fail if errors)
2. Invoke real `smcg` CLI codegen (not the lightweight inline generators — see Spec 73 tension)
3. Write generated code to `{output_dir}/{name}.py` or `{output_dir}/{name}.ts`
4. If `scaffold: true`:
   - **Python:** Generate `pyproject.toml` with `smcraft>=0.1.5` dependency + `main.py` entrypoint
   - **TypeScript:** Generate `package.json` with `smcraft@^0.1.2` dependency + `index.ts` entrypoint
5. Return file paths written

**WebUI "Generate" button** should call this same pipeline via socket.io → server → `smcg`, not attempt browser-side codegen.

### 4. Definition Persistence

**Auto-save:** After every mutation (MCP tool or WebUI edit), server writes to:
```
.smcraft-session/{namespace}.{name}.smdf.json
```

**Recovery:** On MCP server startup, if a session file exists, load it automatically.

## Structural Tension Chart

| # | Current Reality | Desired Outcome | Resolution |
|---|----------------|-----------------|------------|
| 1 | Agent and WebUI are disconnected silos | Single shared definition with real-time sync | Socket.IO bridge between MCP server and WebUI |
| 2 | Agent cannot launch or reference the WebUI | Agent opens designer as part of workflow | `launch_designer` MCP tool |
| 3 | WebUI codegen fails, shows "Copy to Clipboard" | Generate writes files to disk via `smcg` CLI | `generate_to_file` MCP tool + WebUI calls same pipeline |
| 4 | Generated code has no project scaffold | Runnable project with dependencies and entrypoint | `scaffold: true` option on `generate_to_file` |
| 5 | Definition lost on server restart | Auto-persisted, auto-recovered | Session file written after each mutation |

## Implementation Priority

1. **Socket.IO bridge** (enables everything else)
2. **`generate_to_file`** with real `smcg` invocation (resolves broken WebUI codegen too)
3. **`launch_designer`** tool (quality-of-life for agent workflow)
4. **Scaffold generation** (closes the design→run loop)
5. **Session persistence** (resilience)

## Dependencies

- **Spec 70 (SMDF):** Definition format shared across all surfaces
- **Spec 72 (Code Generator):** `smcg` CLI is the authoritative codegen — all paths invoke it
- **Spec 73 (MCP Server):** Extended with new tools and socket.io layer
- **Spec 74 (Web Designer):** WebUI becomes a socket.io client instead of standalone file loader
