/**
 * Where a drawing's pins stand on the screen, and the view that shows its marks (Spec 83).
 *
 * A pin is drawn at the top-right corner of what its mark points at. Marks that point at
 * the same elements share that corner, a corner can fall outside the board, and the
 * board's own buttons sit in its top-right corner too. `placePins` moves each pin as
 * little as it can so that every one can be read and tapped:
 *
 * - inside the board, `inset` pixels from each edge;
 * - out from under the boxes it is told to keep clear of (the board's buttons): just
 *   below them;
 * - apart from the pins already placed: pins on one point fan down the anchor's right
 *   edge, `spacing` apart, and upward when the board ends first.
 *
 * `fitLegibly` frames boxes as `fitToBoxes` does, but never below a scale at which a
 * state's name can still be read: past that floor the view keeps the floor and starts at
 * the boxes' top (and left, when they are wider than the board).
 *
 * Pure: no React, no DOM.
 */
import { fitToBoxes, type Box, type Viewport } from "@miadi/stateloom-protocol";

export interface PinSpot {
  x: number;
  y: number;
}

export interface PinLayout {
  /** The board's size on screen. */
  width: number;
  height: number;
  /** A pin's side, in screen pixels. Default 22 (30 under a finger). */
  size?: number;
  /** How far apart fanned pins stand. Default size + 4. */
  spacing?: number;
  /** Distance kept from the board's edges. Default 8. */
  inset?: number;
  /** Boxes no pin may cover, in the board's screen coordinates (the board's buttons). */
  avoid?: readonly Box[];
}

/** A pin is drawn translated by (-40%, -60%) of its size from its point. */
const LEFT = 0.4;
const UP = 0.6;
const AVOID_GAP = 4;

function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

/** Each spot moved as little as needed: clamped into the board, clear of `avoid`, apart from the others. In order. */
export function placePins(spots: readonly PinSpot[], layout: PinLayout): PinSpot[] {
  const size = layout.size ?? 22;
  const spacing = layout.spacing ?? size + 4;
  const inset = layout.inset ?? 8;
  const avoid = layout.avoid ?? [];
  const minX = inset + LEFT * size;
  const maxX = layout.width - inset - (1 - LEFT) * size;
  const minY = inset + UP * size;
  const maxY = layout.height - inset - (1 - UP) * size;
  const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const boxAt = (x: number, y: number): Box => ({ x: x - LEFT * size, y: y - UP * size, width: size, height: size });
  const blocked = (x: number, y: number): Box | undefined => avoid.find((a) => overlaps(boxAt(x, y), a, AVOID_GAP));
  const placed: PinSpot[] = [];
  const crowded = (x: number, y: number): boolean => placed.some((q) => Math.abs(q.x - x) < size && Math.abs(q.y - y) < size);
  const limit = spots.length + avoid.length + 2;

  /** Down from `y` until nothing is in the way. */
  const down = (x: number, y: number): number => {
    for (let i = 0; i < limit; i++) {
      const under = blocked(x, y);
      if (under) y = under.y + under.height + AVOID_GAP + UP * size;
      else if (crowded(x, y)) y += spacing;
      else break;
    }
    return y;
  };
  /** Up from `y` until nothing is in the way. */
  const up = (x: number, y: number): number => {
    for (let i = 0; i < limit; i++) {
      const over = blocked(x, y);
      if (over) y = over.y - AVOID_GAP - (1 - UP) * size;
      else if (crowded(x, y)) y -= spacing;
      else break;
    }
    return y;
  };

  for (const spot of spots) {
    const x = clamp(spot.x, minX, maxX);
    const wanted = clamp(spot.y, minY, maxY);
    let y = down(x, wanted);
    // The board ended first: fan upward from where the pin wanted to be.
    if (y > maxY) y = Math.max(minY, up(x, wanted));
    placed.push({ x, y });
  }
  return placed;
}

export interface LegibleFitOptions {
  /** Screen-space breathing room on every side. Default 48. */
  padding?: number;
  /** The smallest scale the view may take. Default 0.55. */
  floor?: number;
  /** Never larger than this. Default 1. */
  maxScale?: number;
}

/** The view that frames `boxes` in a board of `width` × `height`, never smaller than `floor`. */
export function fitLegibly(boxes: readonly Box[], width: number, height: number, options: LegibleFitOptions = {}): Viewport {
  const padding = options.padding ?? 48;
  const floor = options.floor ?? 0.55;
  const fitted = fitToBoxes(boxes, width, height, { padding, maxScale: options.maxScale ?? 1 });
  if (!boxes.length || fitted.scale >= floor) return fitted;
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
  const scale = floor;
  const w = (maxX - minX) * scale;
  const h = (maxY - minY) * scale;
  return {
    x: w <= width - padding * 2 ? (width - w) / 2 - minX * scale : padding - minX * scale,
    y: h <= height - padding * 2 ? (height - h) / 2 - minY * scale : padding - minY * scale,
    scale,
  };
}
