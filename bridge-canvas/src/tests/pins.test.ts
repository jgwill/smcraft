/**
 * Where pins stand (Spec 83, lane U finding U3): inside the board, fanned when they
 * share a point, clear of the board's buttons; and a view of the marks that stays legible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLegibly, placePins } from "../pins.js";

const board = { width: 390, height: 600, size: 30, spacing: 34, inset: 8 };

test("pins on one point fan down the anchor's right edge, spacing apart", () => {
  const out = placePins([{ x: 200, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 300 }], board);
  assert.deepEqual(out.map((p) => p.x), [200, 200, 200]);
  assert.deepEqual(out.map((p) => p.y), [300, 334, 368]);
  // Nearly the same point: it keeps its own x and moves down until it overlaps none.
  const near = placePins([{ x: 200, y: 300 }, { x: 201, y: 302 }], board);
  assert.equal(near[1].x, 201);
  assert.ok(Math.abs(near[1].y - near[0].y) >= 30, "no two pins overlap");
});

test("a pin past the board's edge is brought inside it, inset from the edge", () => {
  const [right, left, top] = placePins([{ x: 403, y: 263 }, { x: -50, y: 100 }, { x: 100, y: -40 }], board);
  // A pin is drawn 40 % left and 60 % up of its point.
  assert.equal(right.x, 390 - 8 - 0.6 * 30);
  assert.equal(left.x, 8 + 0.4 * 30);
  assert.equal(top.y, 8 + 0.6 * 30);
  assert.equal(right.y, 263, "only the axis that overflowed moves");
});

test("a pin under the board's buttons moves just below them", () => {
  const controls = { x: 239, y: 8, width: 139, height: 36 };
  const [p] = placePins([{ x: 300, y: 20 }], { ...board, avoid: [controls] });
  assert.equal(p.x, 300);
  assert.ok(p.y - 0.6 * 30 >= controls.y + controls.height, `the pin's top (${p.y - 18}) is below the buttons`);
  const [free] = placePins([{ x: 100, y: 20 }], { ...board, avoid: [controls] });
  assert.equal(free.y, 26, "a pin clear of them stays (clamped to the inset only)");
});

test("pins fanned at the bottom of the board fan upward instead", () => {
  const out = placePins([{ x: 200, y: 580 }, { x: 200, y: 580 }], board);
  const bottom = 600 - 8 - 0.4 * 30;
  assert.equal(out[0].y, bottom);
  assert.equal(out[1].y, bottom - 34);
});

test("pins that do not touch keep their places", () => {
  const spots = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
  assert.deepEqual(placePins(spots, board), spots);
  assert.deepEqual(placePins([], board), []);
});

test("fitLegibly frames the boxes, and past the floor keeps the floor and starts at their top", () => {
  const small = [{ x: 0, y: 0, width: 200, height: 100 }];
  const v = fitLegibly(small, 400, 400, { padding: 20 });
  assert.equal(v.scale, 1, "never magnified");
  const tall = [{ x: 0, y: 0, width: 200, height: 2000 }];
  const t = fitLegibly(tall, 390, 500, { padding: 48, floor: 0.55 });
  assert.equal(t.scale, 0.55);
  assert.equal(t.y, 48, "the boxes' top at the padding");
  assert.equal(t.x, (390 - 200 * 0.55) / 2, "centred across when they fit across");
  const wide = [{ x: 100, y: 0, width: 3000, height: 3000 }];
  const w = fitLegibly(wide, 390, 500, { padding: 48, floor: 0.55 });
  assert.equal(w.x, 48 - 100 * 0.55, "their left at the padding when they are wider than the board");
});
