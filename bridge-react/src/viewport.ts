/**
 * Viewport math for a pannable / zoomable diagram surface.
 *
 * A viewport is the single affine transform that maps *world* coordinates (the
 * numbers in `layout.positions`, which `autoLayout` derives and a drag edits)
 * onto *screen* coordinates (pixels inside the canvas element):
 *
 *     screen = world * scale + {x, y}
 *
 * Written the way an SVG reads it, that is `translate(x, y) scale(scale)` on a
 * single content group — one attribute, applied once, so every child inherits
 * the same navigation without knowing it exists.
 *
 * Pure: no React, no DOM, no store. The canvas owns the pixels; this module
 * owns the arithmetic, so any other renderer of these definitions — forgewright
 * included — gets the same pan, the same clamps, and the same anchored zoom.
 */

export interface Viewport {
  /** Screen-space x of the world origin. */
  x: number;
  /** Screen-space y of the world origin. */
  y: number;
  /** World-to-screen magnification. */
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

/**
 * How far a board may be pushed away or pulled in. The floor keeps a very tall
 * machine legible-in-outline rather than a grey smear; the ceiling stops a
 * mis-scrolled trackpad from stranding the user inside one rectangle.
 */
export const VIEWPORT_LIMITS: ScaleLimits = { min: 0.2, max: 2.5 };

/** The un-navigated view: world coordinates are screen coordinates. */
export const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

/** Confine a scale to the limits; non-finite input falls back to 1. */
export function clampScale(scale: number, limits: ScaleLimits = VIEWPORT_LIMITS): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(limits.max, Math.max(limits.min, scale));
}

/** Repair a partially-trusted viewport (localStorage, URL, another peer). */
export function normalizeViewport(
  candidate: Partial<Viewport> | null | undefined,
  limits: ScaleLimits = VIEWPORT_LIMITS
): Viewport {
  if (!candidate) return { ...IDENTITY_VIEWPORT };
  const x = Number.isFinite(candidate.x) ? (candidate.x as number) : 0;
  const y = Number.isFinite(candidate.y) ? (candidate.y as number) : 0;
  return { x, y, scale: clampScale(candidate.scale ?? 1, limits) };
}

/** Screen point (relative to the canvas element) → world point. */
export function screenToWorld(viewport: Viewport, screen: Point): Point {
  return {
    x: (screen.x - viewport.x) / viewport.scale,
    y: (screen.y - viewport.y) / viewport.scale,
  };
}

/** World point → screen point (relative to the canvas element). */
export function worldToScreen(viewport: Viewport, world: Point): Point {
  return {
    x: world.x * viewport.scale + viewport.x,
    y: world.y * viewport.scale + viewport.y,
  };
}

/**
 * A screen-space drag of (dx, dy) pixels expressed as a world-space delta —
 * what a dragged state must move so it stays under the pointer at any zoom.
 */
export function screenDeltaToWorld(viewport: Viewport, dx: number, dy: number): Point {
  return { x: dx / viewport.scale, y: dy / viewport.scale };
}

/** Slide the view by a screen-space delta. Scale is untouched. */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale };
}

/**
 * Multiply the zoom by `factor`, keeping the world point currently under
 * `anchor` (a screen point) exactly under `anchor` afterwards — the invariant
 * that makes cursor-anchored zoom feel like the board is being pulled toward
 * the pointer instead of drifting away from it.
 *
 * Returns the same viewport object when the scale is already at the clamp, so
 * a caller can skip a no-op render.
 */
export function zoomAt(
  viewport: Viewport,
  factor: number,
  anchor: Point,
  limits: ScaleLimits = VIEWPORT_LIMITS
): Viewport {
  return zoomTo(viewport, viewport.scale * factor, anchor, limits);
}

/** `zoomAt` with an absolute target scale instead of a multiplier. */
export function zoomTo(
  viewport: Viewport,
  targetScale: number,
  anchor: Point,
  limits: ScaleLimits = VIEWPORT_LIMITS
): Viewport {
  const scale = clampScale(targetScale, limits);
  if (scale === viewport.scale) return viewport;
  const world = screenToWorld(viewport, anchor);
  return {
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
    scale,
  };
}

export interface FitOptions {
  /** Screen-space breathing room kept on every side. Default 48. */
  padding?: number;
  /**
   * Ceiling applied to the fitted scale. Default 1 — a small machine is shown
   * at its natural size and centred rather than blown up to fill the pane.
   */
  maxScale?: number;
  limits?: ScaleLimits;
}

/**
 * The viewport that frames every box inside a canvas of `width` × `height`,
 * centred. An empty set leaves the view untouched (identity).
 */
export function fitToBoxes(
  boxes: readonly Box[],
  width: number,
  height: number,
  options: FitOptions = {}
): Viewport {
  const padding = options.padding ?? 48;
  const maxScale = options.maxScale ?? 1;
  const limits = options.limits ?? VIEWPORT_LIMITS;
  if (boxes.length === 0 || width <= 0 || height <= 0) return { ...IDENTITY_VIEWPORT };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const scale = clampScale(
    Math.min(maxScale, Math.min(usableW / contentW, usableH / contentH)),
    limits
  );

  return {
    x: (width - contentW * scale) / 2 - minX * scale,
    y: (height - contentH * scale) / 2 - minY * scale,
    scale,
  };
}

/** The SVG `transform` attribute for a content group under this viewport. */
export function viewportTransform(viewport: Viewport): string {
  return `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
}

/** Structural equality — cheap enough to gate a render or a write. */
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}
