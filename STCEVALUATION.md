# STCEVALUATION

*Here lies what is needed for future enhancement/refactoring of smcraft and its MCP.*

---

## Ceremony `65438273-888a-487d-855d-ede6e7a1ee6f`

**Date:** 2026-03-15
**Focus:** First-contact skill-building and quality evaluation of `smcraft-mcp`
**Artifacts:** [`stcevaluations/65438273-888a-487d-855d-ede6e7a1ee6f/`](stcevaluations/65438273-888a-487d-855d-ede6e7a1ee6f/)

---

## What Works Well

| Aspect | Assessment |
|--------|-----------|
| **Design flow** | `create → add_state → add_event → add_transition → validate → generate_code` is intuitive and conversational |
| **API surface** | 11 tools, clean separation of concerns, minimal required params |
| **JSON roundtrip** | `get_definition` / `load_definition` enables version-control-friendly persistence |
| **Runtime alignment (Python)** | Generated code imports `Context`, `State`, `TransitionHelper` — all confirmed present in `smcraft.runtime` (PyPI 0.1.4/0.1.5) |
| **Validation step** | Catches structural errors before codegen — correct placement in the pipeline |

## Incomplete Loop — The Missing Steps

The generative pipeline currently stops at code generation:

```
Design ✅ → Generate ✅ → Scaffold ❌ → Install ❌ → Run ❌
```

### Recommendation: `scaffold_project` tool

A new MCP tool (or enhancement to `generate_code`) that:

1. **Creates project structure** — `pyproject.toml` or `package.json` with `smcraft` as dependency
2. **Generates an entrypoint** — `main.py` / `index.ts` that instantiates the Context, wires initial state, and provides event dispatch (CLI or programmatic)
3. **Install instructions or script** — `pip install smcraft` / `npm install smcraft`

Without this, the user receives library code (classes inheriting from the runtime) but not application code (a runnable project). The seed exists without soil.

## Unexplored Features to Evaluate Next

- [ ] **Nested/hierarchical states** (`parent` param) — does codegen handle parent-child correctly?
- [ ] **History states** (`kind: "history"`) — are semantics preserved in generated code?
- [ ] **Guard conditions** (`condition` on transitions) — do they appear in codegen output?
- [ ] **Async mode** (`asynchronous: true`) — does it target `ContextAsync` from the runtime?
- [ ] **Roundtrip fidelity** — `load_definition(get_definition())` preserving everything
- [ ] **Edge cases** — duplicate names, self-transitions, orphan events, 20+ state scale
- [ ] **TypeScript runtime alignment** — npm `smcraft@0.1.2` exports need verification

## RISE Spec Produced

This ceremony produced **[Spec 75: Agent ↔ Designer Bridge](rispecs/75-agent-designer-bridge.spec.md)** — covering:
- Socket.IO live sync between MCP agent session and WebUI
- `launch_designer` MCP tool (agent opens the visual editor)
- `generate_to_file` MCP tool (codegen writes to disk, not clipboard)
- Scaffold generation (`pyproject.toml` / `package.json` + entrypoint)
- Session persistence (auto-save after each mutation)

## Summary

`smcraft-mcp` delivers a clean, conversational state machine design experience. The core design→validate→generate loop is solid. The structural tension is between "generated code" and "running application" — closing that loop with scaffolding/bootstrap tooling would make the full pipeline generative end-to-end.
