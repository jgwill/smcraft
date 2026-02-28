----
2602281050
----

Use `/rise-pde-session` protocol for this task.

## Context

smcraft (State Machine Craft) was built from @caishen/rispecs/StateMachineries/ (Specs 60-63). It has:
- **Python pkg** (`smcg` CLI) — parse `.smdf.json` → validate → generate Python state machine code → runtime
- **TypeScript pkg** — mirrors Python (model, parser, runtime, codegen)
- **MCP server** (11 tools) — in-memory design session, but uses its own lightweight codegen instead of the real `PythonCodeGenerator`
- **Web designer** (Next.js, SVG canvas) — drag-and-drop state placement, transition wiring, event management, validation panel. Built but **flat** — no nested state drill-down

## Three Deliverables

### 1. Create RISE rispecs → `./smcraft/rispecs/`

Read @llms/llms-rise-framework.txt. Create specs covering:
- **SMDF format** (the definition schema, validation rules V001-V014)
- **Runtime** (State, Context, ContextAsync, TransitionHelper, observers)
- **Code generator** (Python + TypeScript targets)
- **MCP server** (11 tools, design session protocol)
- **Web designer** (components, store, canvas, MMOT vision)

Reference the caishen originals: @caishen/rispecs/StateMachineries/60-*.md through 63-*.md

### 2. Implement & Test

**Priority items:**
- **MMOT** (@smcraft/MMOT.md): Composite state drill-down in web designer — click a composite state to enter its sub-diagram, navigate back to parent. The data model already supports `StateDef.states[]` recursion; the canvas `collectAllStates()` currently flattens everything
- **MCP codegen → real package**: Wire MCP `generate_code` tool to invoke the actual Python `PythonCodeGenerator` (or TS equivalent) instead of the inline lightweight reimplementation
- **Validation gaps**: Implement V009 (history only in composite), V010 (parallel has regions), V011 (parallel nextState valid), V014 (timer refs exist) in `parser.py`
- **Web → backend bridge**: Connect "Generate" button in web designer to `smcg` CLI or a REST endpoint so it produces real generated code, not just JSON export

Use playwright MCP to test web interactivity.

### 3. KINSHIP upgrades

Update @smcraft/KINSHIP.md to reflect:
- smcraft as a future library/extension for mia-code-server (creative process stages as state machines)
- Relationship to RISE framework itself (structural tension → state transitions is a natural mapping)
- Connection to jgt-strategy-api (the 13-state FSM was designed via smcraft patterns)

Review `/workspace/repos/miadisabelle/mia-code-server/rispecs/` and update its `KINSHIP.md` with smcraft integration points. Draft any needed rispecs there.


----
FOLLOIiwng up....
-----


