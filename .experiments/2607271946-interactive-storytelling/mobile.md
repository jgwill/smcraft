# Mobile — making the designer work on a phone

**Stamp:** 2026-07-28 · built, server restarted, verified over the network, committed
**Trigger:** Guillaume opened `http://100.104.5.64:4598` on his phone and it rendered, but unusably.
**Method:** two specialist sub-agents on disjoint file sets, run concurrently; orchestrator surveyed first, fixed the seam neither owned, built, restarted, verified.

---

## The root cause was one missing line

`web/src/app/layout.tsx` had **no viewport declaration at all** — no `export const viewport`, no meta tag. Mobile browsers therefore fell back to a ~980px layout viewport and shrink-to-fit. Everything else was aggravation on top of that.

The rest, verified by reading the files before dispatching:

| Defect | Where |
|---|---|
| `h-screen` — iOS URL bar makes `100vh` wrong | `page.tsx:34` |
| Hard `w-80` sidebar always rendered — left ~70px of canvas on a 390px phone | `page.tsx:44` |
| `touchAction: "none"` with **no** replacement gestures — pinch impossible | `Canvas.tsx:467` |
| Zoom bound to `Ctrl+wheel`; pan to middle-drag or `Space`+drag | `Canvas.tsx:248-273, 783-785` |
| Context menu right-click only → **"Add state" unreachable on touch** | `page.tsx` + store |
| Tap targets at `text-xs` / `py-0.5` / `text-[9px]` | `globals.css`, panels |

## Division of labour

Disjoint ownership, enforced in the briefs, so two agents could run concurrently without a worktree:

- **Shell agent** (`a30c4886f412f6512`) — `layout.tsx`, `page.tsx`, `globals.css`, `Toolbar`, all four panels, `CodePreview`, `SocketBridgeProvider`. Explicitly forbidden from `Canvas.tsx`.
- **Canvas agent** (`a0803f97e614b76a5`) — `Canvas.tsx` and nothing else.

Both were told: never `cd` out of the repo, never touch `/a/src/Miadi`, run no git command, and do not restart the server — a live session was on Guillaume's phone at the time.

## What was built

**Shell — bottom sheet + fixed tab dock.** One element, two shapes: below `md` an overlay sheet starting closed so the canvas owns the whole screen; at `md`+ the unchanged static `w-80` right column. The dock keeps the error badge on screen permanently (a drawer would hide it) and costs zero canvas *width*. Desktop toolbar kept byte-identical via a `display: contents` trick at `md`. A `@media (pointer: coarse)` block floors controls at 44px and forces 16px inputs to stop iOS focus-zoom, without touching desktop density.

**Canvas — a real gesture state machine.** A pointer map fed by `onPointerDownCapture` (which runs before a node's `stopPropagation` can hide the press). One finger on bare canvas pans and arms a 500ms/8px long-press; one finger on a box still drags the box. A second finger surrenders whatever the first claimed and opens a pinch, recording distance, midpoint and viewport once — every move recomputes from that opening frame, so pinch and `Ctrl+wheel` share one anchor invariant and long pinches cannot drift. Lifting one finger hands a fresh pan to the survivor. Long-press reuses the store's existing `showContextMenu` — no second menu — with `navigator.vibrate?.(10)` guarded. Enlarged hit areas (invisible cuffs behind boxes, `pointerEvents="stroke"` ribbons along edges) render **only** under `(pointer: coarse)`, so mouse hit-testing geometry is literally unchanged.

## The seam neither agent owned

Both reports independently flagged it: the context menu is `position: fixed` at raw press coordinates. The shell agent clamped width; nobody clamped height, and the bottom edge is exactly where a thumb rests. Fixed by the orchestrator in `page.tsx` — `contextMenuPlacement()` flips the menu past the screen midpoint rather than measuring it, because a measure-then-correct pass paints once at the wrong place and visibly snaps.

*That is the argument for disjoint ownership plus a review pass: the parallelism was clean, and the defect lived precisely in the gap between the two briefs.*

## Verification actually run

- `tsc --noEmit -p web/tsconfig.json` → **exit 0**
- `npm --prefix web run build` → **compiled successfully**, 5 routes generated
- Server killed (pid 539884) and restarted through the project's own `scripts/live-loop.sh web` with the running process's exact env, so nothing drifted
- `curl http://100.104.5.64:4598` → serves
  `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no, interactive-widget=resizes-content"/>`
- New classes `app-shell`, `dock-offset`, `toolbar-strip` present in served HTML
- `/api/file` still serving `InteractiveProduction` with `MusicalComposition`

## Unverified — needs Guillaume's actual phone

Neither agent nor the orchestrator had a device. Untested on hardware:

- dvh, safe-area insets, and dock geometry
- whether iOS Safari honours `user-scalable=no` — if not, browser pinch competes with canvas pinch
- `interactive-widget=resizes-content` is Chromium-only
- long-press feel: whether 500ms / 8px slop are right
- `navigator.vibrate` is absent on Safari (guarded, silently skipped)
- the ≤8px of pan a tap produces before slop clears

🌸: The app was never too big for the phone. It simply had never been told the phone was there — and once it knew, the harder question was whether a finger passing through is the same as a finger asking to stay. It waits half a second now before deciding.
