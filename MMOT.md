# MMOT — smcraft Performance Review

> Managerial Moment of Truth applied to the smcraft toolkit itself.
> Evaluation model: `smcraft-evaluation.tandt.json` (veritas Type 2)

## Step 1: Acknowledge the Truth

smcraft has **strong design heritage** (caishen specs 60-63) and **working flat-state execution** (Python CLI, MCP tools, web designer). But there is a clear expectation-delivery discrepancy:

**Expectation**: A toolkit where humans and LLM agents design hierarchical state machine workflows — including composite states, parallel regions, and inner-end → parent-exit linking — across Python, TypeScript, MCP, and a visual web designer, all connected.

**Delivery**: A toolkit that works for **flat state machines only**. The data model supports hierarchy, but nothing above it exposes it.

## Step 2: How It Got This Way (Design vs Execution)

### Where DESIGN is adequate, EXECUTION matches

| Dimension | D | E | Notes |
|---|---|---|---|
| SMDF schema | ✅ | ✅(partial) | Schema is solid. Parser validates 10/14 rules. |
| Runtime engine | ✅ | ✅ | Working end-to-end. Streetlight test passes. |
| Web designer (flat) | ✅ | ✅ | 7 components, undo/redo, draw mode, all functional |
| MCP tool surface | ✅ | ✅(partial) | 11 tools functional, but codegen is a reimplementation |

### Where DESIGN is adequate but EXECUTION falls short

| Dimension | D | E | Tension |
|---|---|---|---|
| Code generation | ✅ | ❌ | Three separate codegen implementations (Python pkg, TS pkg, MCP inline). CLI only targets Python. Not unified. |
| MCP persistence | ✅ | ❌ | In-memory only. Design session lost on restart. |

### Where DESIGN itself is missing

| Dimension | D | E | Tension |
|---|---|---|---|
| **Hierarchical state modeling** | ❌ | ❌ | The core unresolved tension. No spec for: drill-down UX, breadcrumb navigation, inner-end → parent-exit semantics, parallel region visual rendering |
| Web → backend bridge | ❌ | ❌ | No design for how the web designer calls `smcg` or any codegen API |
| RISE specifications | ❌ | ❌ | No autonomous smcraft rispecs exist |
| mia-code-server integration | ❌ | ❌ | Creative process stages as FSMs not designed |

## Step 3: Action Plan

### CRITICAL (Unacceptable + Declining)

1. **Specify hierarchical state modeling** — Write a RISE spec for MMOT/composite drill-down: what the UX looks like, how inner-end links to parent-exit, how the MCP tools expose depth, how the web canvas navigates levels
2. **Specify web → backend bridge** — REST endpoint or CLI invocation that connects "Generate" button to real codegen
3. **Test coverage** — Pytest suite for parser validation rules, runtime transitions, codegen output correctness

### IMPORTANT (Unacceptable + Stable)

4. **Unify codegen** — MCP `generate_code` should invoke the real PythonCodeGenerator/TypeScriptCodeGenerator, not reimplement
5. **smcg CLI TypeScript target** — Wire `ts/src/codegen.ts` to CLI with `-l typescript`
6. **Parser validation gaps** — Implement V009, V010, V011, V014
7. **MCP persistence** — Save/load definitions to filesystem

### WATCH (Unacceptable + Improving)

8. **RISE specifications** — Create smcraft/rispecs/ (in progress this session)
9. **Web designer UX** — Canvas is functional and improving; needs MMOT drill-down as next advancement

### MAINTAIN (Acceptable + Stable)

10. SMDF schema — solid, no changes needed
11. Python runtime — working, maintain

## Step 4: Documentation

This file IS the documentation artifact. The `smcraft-evaluation.tandt.json` is the structured model that can be loaded into veritas for ongoing review cycles.

**Next review**: After the agent session completes issue #50 deliverables.
