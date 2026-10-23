# Rispec 79 — Layout persistence for the live canvas (PLAN ONLY)

**Status:** plan — no implementation. Written 2026-07-27 by the Tushell guardian
lane at William's word: *"maybe first to just remember its position in the
current browser and keep the rest as spec level… larger thinking that would be
later."*

## Current reality

- Node positions live only in `useDesignerStore.layout.positions`
  (browser memory). A refresh forgets every drag.
- Auto-layout (`@miadi/stateloom-react` `autoLayout`, rispec-77 lineage) places
  states that have no stored position; the Arrange action overwrites all.
- In flight (2026-07-27): browser-local memory via localStorage keyed by docId,
  so one browser remembers its own arrangement. That is deliberately the
  smallest layer and is NOT this spec — this spec is everything beyond it.
- The `.smdf.json` definition carries **no geometry**. The hub broadcasts
  def+runtime patches only; two viewers of one doc each hold private layouts.

## Desired outcome

A layout, once cared for, travels: reopen the doc anywhere — another browser,
another machine, forgewright on ilex — and the machine greets you arranged the
way its people left it, without geometry ever polluting the semantic definition
consumed by codegen and the runtime interpreter.

## The design questions the later thinking must answer

1. **Where geometry lives.** Three candidates:
   - **In-file** (`stateMachine.layout` block inside `.smdf.json`): travels with
     the doc automatically (episodes! forgewright!), but every drag dirties the
     semantic file, churns the hub watcher, pollutes codegen inputs, and makes
     agent diffs noisy. Mitigable (interpreter/codegen ignore `layout`), but the
     file stops being purely semantic.
   - **Sidecar** (`<name>.smdf.layout.json` beside the doc): clean separation,
     travels with episode commits if the convention says "commit both", needs
     its own watch/broadcast lane and a rule for staleness when states are
     renamed/deleted.
   - **Per-viewer store** (browser localStorage / forgewright's own cache):
     zero contamination, zero travel — what the small layer already gives.
   Leaning at spec time: **sidecar**, because episodes are the destination and
   a sidecar rides `git add` naturally, like ep090's companion `.md` diagrams.
2. **Who wins.** Two viewers arrange one doc differently; a third joins cold.
   Options: last-writer-wins on the sidecar (simple, honest), per-viewer
   override layered over a shared base (complex, kind), or explicit "publish
   layout" as a deliberate act (EAST-before-WEST: arranging is seeing;
   publishing an arrangement is an action someone consents to). Leaning:
   **explicit publish** — a "Save layout" act writes the sidecar; live drags
   stay local.
3. **Staleness semantics.** A sidecar naming states that no longer exist, or
   missing new states: positions apply where names match; auto-layout fills the
   rest; never error.
4. **Protocol surface.** If sidecars broadcast live (viewer A arranges, viewer B
   sees it move), the bridge needs a `layout` envelope kind — or layout stays
   pull-only (read at join, write on publish) and nobody's canvas jumps under
   their hands. Leaning: **pull-only first**; live layout sync is its own later
   spec if ever wanted.
5. **Forgewright travel.** Read-only rendering on ilex wants: def + optional
   sidecar → `autoLayout` fallback. That works offline with zero new protocol —
   another vote for sidecar.

## Phasing (later work, in order)

- **79.A** — sidecar read: web + forgewright load `<name>.smdf.layout.json`
  when present; matched names win over autoLayout. No writes.
- **79.B** — explicit "Save layout" action writes the sidecar (and an MCP tool
  twin so agents can save an arrangement they were asked to produce).
- **79.C** — episode convention update: `diagrams/` commits sidecars beside
  machines; ep103's two film machines become the first arranged inhabitants.
- **79.D** (only if wanted) — live layout envelopes over the bridge.

## Non-goals

Geometry inside the semantic definition; automatic layout sync that moves a
canvas under a person's hands; any implementation before the small
browser-local layer has taught us how arrangements are actually used.
