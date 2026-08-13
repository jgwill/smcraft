/**
 * Who owns a two-finger gesture.
 *
 * There are exactly two pinch handlers in this app and they must never both fire
 * on one gesture. The rule that keeps them apart is a property of *where the
 * fingers landed*, decided once, at touch-down, and never revisited:
 *
 *   · The canvas pinch (Canvas.tsx) counts fingers in `pointersRef`, and a
 *     pointer only ever enters that map from a `pointerdown` that hit the canvas
 *     pane. So the canvas needs **both** fingers on itself before it will pinch.
 *   · The chrome pinch (UiScale.tsx) begins only when **neither** finger is on
 *     the canvas pane, which it tests with the selector below.
 *
 * The two conditions are mutually exclusive by construction, and they leave one
 * deliberate hole: a finger on the canvas and a finger on the toolbar starts
 * nothing at all. That is the honest answer — the gesture is genuinely ambiguous
 * — and it is far better than a hand that straddles the boundary silently
 * resizing both the board and the menus.
 */

/**
 * Marks the canvas pane. Read by the chrome pinch to disqualify itself. The
 * attribute name is written literally as `data-pinch-owner` on the pane in
 * Canvas.tsx — JSX cannot take it from a constant without a spread — so these
 * two strings are the pair to keep in step if it is ever renamed.
 */
export const PINCH_OWNER_ATTR = "data-pinch-owner";
export const CANVAS_PINCH_OWNER = "canvas";
export const CANVAS_PANE_SELECTOR = `[${PINCH_OWNER_ATTR}="${CANVAS_PINCH_OWNER}"]`;

/** Is this touch resting on the canvas pane (the SVG, its HUD, its breadcrumb)? */
export function isOnCanvasPane(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest(CANVAS_PANE_SELECTOR) !== null;
}
