"use client";

/**
 * How big the chrome is.
 *
 * The canvas has always owned one kind of zoom: `viewport.scale`, which magnifies
 * the *machine* and leaves the toolbar, the panels and the dock exactly where
 * they were. Nothing owned the other kind — the one a person means when they say
 * "the buttons are too small to hit". On a desktop the browser's own page zoom
 * answers that; on a phone it does not, because the app deliberately denies
 * browser zoom so the canvas can keep two-finger gestures for itself.
 *
 * So the chrome grows by a different lever: the root font size. Tailwind v4's
 * spacing, type and sizing scales are all expressed in `rem`, so every padding,
 * every label, every 44px touch floor is already a multiple of one number. Move
 * that number and the entire chrome rescales in one reflow, with no class
 * rewrite and no second design.
 *
 * Two consequences worth knowing, because they are what makes this safe:
 *
 *   · The canvas does *not* follow. The `<svg>` is sized `w-full h-full` (a
 *     percentage of a flex box) and everything inside it is drawn in SVG user
 *     units — `fontSize={14}` on a node label is 14 user units, not 14px. So the
 *     board stays exactly the size the viewport says it is.
 *   · The phone dock stays aligned for free. `--sm-dock-h` is `3.5rem` and the
 *     dock is `h-14`, which is the same `3.5rem`; both move together, so the
 *     padding that keeps content clear of the dock never falls out of step.
 *
 * The one thing that must NOT scale is the indicator that lets you undo this —
 * see `.ui-scale-pill` in globals.css, which is sized in px on purpose.
 */

/** Below this the 44px touch floors stop being touchable; above it a phone toolbar eats the screen. */
export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 1.75;

/** The browser default the whole rem scale is calibrated against. */
export const UI_SCALE_BASE_PX = 16;

const STORAGE_KEY = "stateloom.uiScale.v1";

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

/** This browser's remembered chrome size. Anything unreadable reads as 1. */
export function readUiScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    return clampUiScale(Number.parseFloat(raw));
  } catch {
    return 1;
  }
}

/** Remember it. Private mode and a full quota are not worth failing a gesture over. */
export function writeUiScale(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampUiScale(value)));
  } catch {
    // The chrome keeps the size it has for this session; only the memory is lost.
  }
}

/**
 * Put the scale on the glass. This is the entire mechanism — one property on one
 * element — which is why a pinch can drive it straight from a touch-move without
 * waiting on a render.
 */
export function applyUiScale(value: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = `${UI_SCALE_BASE_PX * clampUiScale(value)}px`;
}

/* --- The scale as an external store --------------------------------------
 *
 * The chrome size lives outside React, because that is what it honestly is: a
 * property of the document, set by a gesture and remembered by the browser,
 * which React only ever *observes* in order to draw the reset pill. Holding it
 * in `useState` and restoring it from an effect would mean rendering the app at
 * 100% and then correcting — a cascading render on every mount. `useSyncExternal
 * Store` exists for exactly this shape, and its server/client snapshot split is
 * also what keeps hydration honest: the server has no localStorage, so it always
 * renders 100%, and the client reconciles to the remembered size immediately
 * after.
 */

let snapshot = 1;
let readFromStorage = false;
const listeners = new Set<() => void>();

/** What the client believes. The first read is where storage is consulted. */
export function getUiScale(): number {
  if (!readFromStorage) {
    readFromStorage = true;
    snapshot = readUiScale();
  }
  return snapshot;
}

/** What the server renders: no storage there, so always the default. */
export function getServerUiScale(): number {
  return 1;
}

export function subscribeUiScale(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Move the chrome. The glass is updated first and unconditionally — a gesture
 * must not wait on a render to look like it is working — and `persist` is what
 * separates a size still being chosen by two fingers from one they settled on.
 */
export function setUiScale(value: number, persist: boolean): void {
  const next = clampUiScale(value);
  applyUiScale(next);
  if (persist) writeUiScale(next);
  readFromStorage = true;
  if (next === snapshot) return;
  snapshot = next;
  for (const notify of listeners) notify();
}
