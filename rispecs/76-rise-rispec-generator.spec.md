# RISE Rispec Generator — SMDF as Exportation Terminus

> RISE Framework Specification
> References: Spec 70 (SMDF), Spec 73 (MCP Server), Spec 74 (Web Designer), Spec 75 (Bridge)
> Origin: Issue #10 / PR #11 (2026-04-16) — "get to the end where we shall have something we can actually try"
> Implementation: `mcp/src/server.ts` (`generate_rispec` tool), `web/src/app/api/rispec/route.ts` (HTTP mirror), `web/src/components/Toolbar.tsx` (📜 RISE button)

**Spec ID**: 76
**Version**: 1.0
**Status**: **implemented** (minimum-viable generator; PDE enrichment wired)

## Creative Intent

**What This Enables Users to Create:**
A two-way loop between *design* (SMDF state machine) and *specification* (RISE rispec). An agent — or a human at the canvas — can emit a RISE framework rispec directly from the current state machine, closing the Miaco chain (PDE → STC → SMDF → codegen) with a proper `E` (Exportation) step that is neither source code nor raw JSON.

**Desired Outcome:**
Any SMDF on disk can be rendered, in one step, as a RISE rispec markdown document containing the four sections — **R**everse Engineering, **I**ntent, **S**pecifications, **E**xportation — with full traceability back to the originating PDE (when one is linked via `settings._source`).

## Current Reality (what exists today)

1. SMDF is the canonical artefact for state-machine design (Spec 70).
2. Codegen (Spec 72) emits Python/TypeScript runtime source — useful for execution, not for ceremony, review, or handoff to a non-coding reader.
3. PDE artefacts (`.pde/<ts>--<uuid>/pde-<uuid>.json`) hold the originating prompt, the Four Directions decomposition, action stack, and ambiguities — but they live next to the SMDF, not inside it.
4. Agents and designers previously had no way to emit a narrative spec from a state machine; RISE rispecs had to be hand-written.

## Specification

### 1. Generator semantics

Given:
- `def`: a SMDF `Definition` (possibly with `settings._source = { pdeId, pdeFolder, originalPrompt }`)
- `pde`: an optional `PdeSource` loaded via `settings._source.pdeFolder` + `pdeId`
- `intent`: an optional string override supplied by the caller
- `projectFile`: absolute path of the SMDF on disk (for the Exportation section)

Produce a markdown document with this structure:

```
# {name} — RISE rispec
> {tagline: intent ?? pde.primary.target ?? _source.originalPrompt ?? "{name} state machine"}

**Namespace:** `{namespace}` · **Async:** {asynchronous}
**Source PDE:** `{pdeId}`      ← only when _source.pdeId is present

---

## R — Reverse Engineering
{count summary: N non-root states across M level(s), Events: E, Transitions: T}

Originating prompt:                ← only when pde.prompt is present
> {pde.prompt}

## I — Intent
**Desired Outcome**
{intent ?? pde.primary.target ?? "_(no intent supplied)_"}

**Vision (🌅 East)**                ← only when pde.directions.east has entries
- {each east direction.text}

**Structural Tension**
- *Current:* {name} {has-final-state → "terminal state reachable" / else "no terminal state declared"}
- *Desired:* {intent ?? pde.primary.target ?? "{name} runs end-to-end..."}

## S — Specifications
### States
{recursive tree render: indent per depth, mark kind when != "normal", list transitions inline}

### Events
{grouped by source: sourceName → bullet list of `{id}` — {description}}

### Transitions (flat)
{one line per transition: `from` --[event]-- → next (or "internal") *(when: condition)*}

### Action Steps                   ← only when any East/South/West/North child exists
{for each direction in [South, East, North, West]:
  {glyph} {direction} — {description}
  1. {each child's description ?? name}
}

### Open Questions                 ← only when pde.ambiguities has entries
- {each ambiguity.text}
  → *{suggestion}*

## E — Exportation
- Code: smcg / `generate_code` mcp tool (python | typescript)
- Visual: this file is bound to `{projectFile}` via SMCRAFT_PROJECT_FILE
- SMDF: the canonical JSON is the file above
```

### 2. PDE linkage

`Definition.settings._source` (optional) carries:
```ts
{
  pdeId?: string          // UUID of the PDE artefact
  pdeFolder?: string      // path to the PDE folder (absolute or relative to SMDF)
  originalPrompt?: string // fallback tagline when no PDE is loadable
}
```

`loadPde(smdfPath, def)` tries, in order:
1. `resolve(dirname(smdfPath), pdeFolder, "pde-{pdeId}.json")`
2. `resolve(pdeFolder, "pde-{pdeId}.json")`

and returns `null` on any failure — the generator degrades gracefully to a PDE-less rispec.

### 3. Three surfaces, one generator

| Surface | Entry point | Input | Output |
|---------|-------------|-------|--------|
| MCP tool | `generate_rispec` in `mcp/src/server.ts` | `{ intent?: string }` | `content: [{ type: "text", text: markdown }]` |
| HTTP API | `POST /api/rispec` in `web/src/app/api/rispec/route.ts` | `{ intent?: string }` body | `{ rispec: string, projectFile: string }` |
| Web UI | `📜 RISE` button in `Toolbar.tsx` | — | Code preview panel shows rendered markdown |

All three paths resolve the same file via `SMCRAFT_PROJECT_FILE` and produce byte-identical output for the same inputs.

## Structural Tension Chart

| # | Current Reality | Desired Outcome | Resolution |
|---|----------------|-----------------|------------|
| 1 | SMDF → code is the only emission; PDE → SMDF has no "back to narrative" step | Any SMDF can be re-narrated as a RISE rispec at any time | `generate_rispec` reads current SMDF + optional linked PDE, renders markdown |
| 2 | PDE artefacts live beside SMDF but aren't woven into specs | Vision, ambiguities, and directions appear in the rispec when a PDE is linked | `settings._source.{pdeId,pdeFolder}` + `loadPde()` graceful degradation |
| 3 | Agent has no "Exportation" tool that isn't code | Agent emits RISE rispec as the final artefact of a design session | MCP `generate_rispec` tool with optional `intent` override |
| 4 | Designer canvas can only export code or JSON | User clicks one button, sees a RISE rispec | `📜 RISE` button → `POST /api/rispec` → code preview panel |

## Future Work

- **Intent-aware pruning**: allow `intent` to scope which states/transitions are rendered (e.g. "focus on the fire-keeper path").
- **Cross-STC rispecs**: when multiple SMDFs cohere into one STC (structural tension chart), render a combined rispec rather than per-file.
- **Round-trip**: parse a RISE rispec back into an SMDF scaffold (the reverse direction — design from narrative).
- **Ceremonial linkage**: when `settings._source` references a ceremony (future field), pull the ceremony's opening/closing into the Exportation section.

## Dependencies

- **Spec 70 (SMDF)**: Source of state/event/transition tree
- **Spec 73 (MCP Server)**: Hosts the `generate_rispec` tool
- **Spec 74 (Web Designer)**: Hosts the 📜 RISE button and the code preview panel
- **Spec 75 (Bridge)**: File-backed store makes "current SMDF" meaningful across surfaces
- **`mcp-pde`**: The PDE artefacts this generator weaves into the Intent section
