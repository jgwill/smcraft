/**
 * Behaviour of the pure viewport math (no React, no DOM, no store).
 *
 * The property that carries the whole navigation layer is the zoom anchor: the
 * world point under the cursor must still be under the cursor after the wheel
 * turns. Everything else — the drag conversion, the clamps, the fit — is what
 * keeps that invariant true at the edges, where a canvas usually breaks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_VIEWPORT,
  VIEWPORT_LIMITS,
  clampScale,
  fitToBoxes,
  normalizeViewport,
  panBy,
  sameViewport,
  screenDeltaToWorld,
  screenToWorld,
  viewportTransform,
  worldToScreen,
  zoomAt,
  zoomTo,
  type Viewport,
} from "../viewport.js";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test("clampScale confines to the limits and survives nonsense", () => {
  assert.equal(clampScale(1), 1);
  assert.equal(clampScale(99), VIEWPORT_LIMITS.max);
  assert.equal(clampScale(0.0001), VIEWPORT_LIMITS.min);
  assert.equal(clampScale(Number.NaN), 1);
  assert.equal(clampScale(Number.POSITIVE_INFINITY), 1);
});

test("screenToWorld and worldToScreen are inverses at any pan and zoom", () => {
  const vp: Viewport = { x: -240, y: 730, scale: 0.65 };
  for (const p of [{ x: 0, y: 0 }, { x: 512, y: 384 }, { x: -90, y: 1200 }]) {
    const round = worldToScreen(vp, screenToWorld(vp, p));
    close(round.x, p.x);
    close(round.y, p.y);
  }
});

test("zoom anchored at the cursor keeps that world point under the cursor", () => {
  const vp: Viewport = { x: 40, y: -300, scale: 0.8 };
  const anchor = { x: 617, y: 214 };
  const before = screenToWorld(vp, anchor);

  const zoomedIn = zoomAt(vp, 1.2, anchor);
  const afterIn = screenToWorld(zoomedIn, anchor);
  close(afterIn.x, before.x);
  close(afterIn.y, before.y);

  const zoomedOut = zoomAt(zoomedIn, 1 / 1.2, anchor);
  const afterOut = screenToWorld(zoomedOut, anchor);
  close(afterOut.x, before.x);
  close(afterOut.y, before.y);
  // …and returns to where it started, so a wheel up/down pair is a round trip.
  close(zoomedOut.scale, vp.scale);
  close(zoomedOut.x, vp.x);
  close(zoomedOut.y, vp.y);
});

test("zoom clamps and reports no-op by identity when already at the limit", () => {
  const anchor = { x: 100, y: 100 };
  const maxed = zoomTo(IDENTITY_VIEWPORT, 99, anchor);
  assert.equal(maxed.scale, VIEWPORT_LIMITS.max);
  assert.equal(zoomAt(maxed, 2, anchor), maxed, "second zoom-in returns the same object");

  const floored = zoomTo(IDENTITY_VIEWPORT, 0.001, anchor);
  assert.equal(floored.scale, VIEWPORT_LIMITS.min);
  assert.equal(zoomAt(floored, 0.5, anchor), floored, "second zoom-out returns the same object");
});

test("a screen drag becomes a smaller world move when zoomed out", () => {
  const zoomedOut: Viewport = { x: 0, y: 0, scale: 0.5 };
  const zoomedIn: Viewport = { x: 0, y: 0, scale: 2 };
  assert.deepEqual(screenDeltaToWorld(zoomedOut, 100, 50), { x: 200, y: 100 });
  assert.deepEqual(screenDeltaToWorld(zoomedIn, 100, 50), { x: 50, y: 25 });
});

test("a dragged box tracks the pointer exactly at any zoom", () => {
  // The canvas rule: newWorld = origWorld + screenDelta / scale. If that holds,
  // the box's screen position moves by exactly the pointer's screen delta.
  const vp: Viewport = { x: 77, y: -410, scale: 0.35 };
  const orig = { x: 300, y: 900 };
  const screenDelta = { x: 64, y: -128 };
  const moved = screenDeltaToWorld(vp, screenDelta.x, screenDelta.y);
  const next = { x: orig.x + moved.x, y: orig.y + moved.y };
  const before = worldToScreen(vp, orig);
  const after = worldToScreen(vp, next);
  close(after.x - before.x, screenDelta.x);
  close(after.y - before.y, screenDelta.y);
});

test("panBy slides the view and leaves the scale alone", () => {
  const vp: Viewport = { x: 10, y: 20, scale: 1.5 };
  assert.deepEqual(panBy(vp, -30, 45), { x: -20, y: 65, scale: 1.5 });
});

test("fitToBoxes frames a tall machine inside the pane and centres it", () => {
  // Nine states stacked the way autoLayout lays them out: ~1180 world units
  // tall, far past an 800px pane.
  const boxes = Array.from({ length: 9 }, (_, i) => ({
    x: 400,
    y: 120 + i * 130,
    width: 160,
    height: 60,
  }));
  const width = 1200;
  const height = 800;
  const vp = fitToBoxes(boxes, width, height, { padding: 40 });

  assert.ok(vp.scale < 1, "a board taller than the pane must be scaled down");
  for (const b of boxes) {
    const tl = worldToScreen(vp, { x: b.x, y: b.y });
    const br = worldToScreen(vp, { x: b.x + b.width, y: b.y + b.height });
    assert.ok(tl.x >= 0 && tl.y >= 0, `box ${b.y} starts inside the pane`);
    assert.ok(br.x <= width && br.y <= height, `box ${b.y} ends inside the pane`);
  }

  // Centred: the slack above the first box equals the slack below the last.
  const top = worldToScreen(vp, { x: 0, y: boxes[0].y }).y;
  const last = boxes[boxes.length - 1];
  const bottom = height - worldToScreen(vp, { x: 0, y: last.y + last.height }).y;
  close(top, bottom, 1e-6);
});

test("fitToBoxes never magnifies a small board past its natural size", () => {
  const vp = fitToBoxes([{ x: 0, y: 0, width: 100, height: 40 }], 1200, 800);
  assert.equal(vp.scale, 1);
});

test("fitToBoxes on an empty board or an unmeasured pane returns identity", () => {
  assert.deepEqual(fitToBoxes([], 1200, 800), IDENTITY_VIEWPORT);
  assert.deepEqual(fitToBoxes([{ x: 0, y: 0, width: 10, height: 10 }], 0, 0), IDENTITY_VIEWPORT);
});

test("normalizeViewport repairs anything a browser store hands back", () => {
  assert.deepEqual(normalizeViewport(null), IDENTITY_VIEWPORT);
  assert.deepEqual(normalizeViewport({}), IDENTITY_VIEWPORT);
  assert.deepEqual(normalizeViewport({ x: 5, y: 6, scale: 900 }), {
    x: 5,
    y: 6,
    scale: VIEWPORT_LIMITS.max,
  });
  assert.deepEqual(
    normalizeViewport({ x: Number.NaN, y: 3, scale: Number.NaN } as Partial<Viewport>),
    { x: 0, y: 3, scale: 1 }
  );
});

test("viewportTransform emits the SVG group transform, and equality is structural", () => {
  assert.equal(viewportTransform({ x: 12, y: -8, scale: 0.5 }), "translate(12 -8) scale(0.5)");
  assert.ok(sameViewport({ x: 1, y: 2, scale: 3 }, { x: 1, y: 2, scale: 3 }));
  assert.ok(!sameViewport({ x: 1, y: 2, scale: 3 }, { x: 1, y: 2, scale: 3.1 }));
});
