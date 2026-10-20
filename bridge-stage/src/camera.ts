/**
 * The camera: from where the board is pointed to where a step wants it, eased,
 * so the eye follows the move instead of being dropped somewhere new.
 */
import type { Viewport } from "@miadi/stateloom-protocol";

export const CAMERA_MS = 480;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function lerpViewport(a: Viewport, b: Viewport, t: number): Viewport {
  const k = ease(Math.min(1, Math.max(0, t)));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, scale: a.scale + (b.scale - a.scale) * k };
}

/**
 * Animate from `from` to `to`, calling `apply` each frame. Returns a cancel.
 * Without `requestAnimationFrame`, or when the person asked for less motion,
 * the view jumps.
 */
export function moveCamera(from: Viewport, to: Viewport, apply: (v: Viewport) => void, ms = CAMERA_MS): () => void {
  const reduced =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  if (typeof requestAnimationFrame === "undefined" || reduced || ms <= 0) {
    apply(to);
    return () => {};
  }
  let frame = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = (now - start) / ms;
    apply(t >= 1 ? to : lerpViewport(from, to, t));
    if (t < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
