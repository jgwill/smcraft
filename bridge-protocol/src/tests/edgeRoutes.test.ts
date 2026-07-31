/**
 * Behaviour of the pure edge routing — where a curve leaves a box and lands.
 *
 * Same shape the label tests use, because it is the shape that exposed the
 * defect: `draft` fanning out to three siblings, each sending an edge back.
 * Twelve attachments, six of them on `draft` alone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PORT_PITCH,
  edgeCurve,
  facingSides,
  portAt,
  routeEdges,
  selfLoopCurve,
} from "../edgeRoutes.js";
import type { LayoutBox } from "../autoLayout.js";

const box = (x: number, y: number): LayoutBox => ({ x, y, width: 160, height: 60 });

const DRAFT = box(400, 100);
const CONFIRMED = box(120, 340);
const SKIPPED = box(400, 340);
const REVISIT = box(680, 340);
const BOXES: Record<string, LayoutBox> = {
  draft: DRAFT,
  confirmed: CONFIRMED,
  skipped: SKIPPED,
  needs_revisit: REVISIT,
};
const boxOf = (name: string): LayoutBox => BOXES[name];

const FAN = [
  { from: "draft", to: "confirmed" },
  { from: "draft", to: "skipped" },
  { from: "draft", to: "needs_revisit" },
  { from: "confirmed", to: "draft" },
  { from: "skipped", to: "draft" },
  { from: "needs_revisit", to: "draft" },
];

test("facingSides: an edge uses the gap that is actually there", () => {
  assert.deepEqual(facingSides(DRAFT, SKIPPED), ["bottom", "top"], "target below");
  assert.deepEqual(facingSides(SKIPPED, DRAFT), ["top", "bottom"], "target above");
  assert.deepEqual(facingSides(CONFIRMED, SKIPPED), ["right", "left"], "target to the right");
  assert.deepEqual(facingSides(REVISIT, CONFIRMED), ["left", "right"], "target to the left");
  assert.deepEqual(facingSides(DRAFT, DRAFT), ["bottom", "top"], "no honest gap: convention");
});

test("portAt: one attachment keeps the centre, several come apart", () => {
  assert.deepEqual(portAt(DRAFT, "bottom", 0, 1), { x: 480, y: 160 }, "centre of the bottom face");
  const three = [0, 1, 2].map((i) => portAt(DRAFT, "bottom", i, 3).x);
  assert.ok(three[0] < three[1] && three[1] < three[2], `ordered left to right: ${three}`);
  assert.equal((three[0] + three[2]) / 2, 480, "the band stays centred on the face");
  for (const x of three) {
    assert.ok(x >= DRAFT.x && x <= DRAFT.x + DRAFT.width, `${x} stays on the face`);
  }
});

test("portAt: a pair sits PORT_PITCH apart, not at the corners", () => {
  const [a, b] = [0, 1].map((i) => portAt(DRAFT, "bottom", i, 2).x);
  assert.equal(b - a, PORT_PITCH);
});

test("routeEdges: six edges on one state get six attachment points", () => {
  const curves = routeEdges(FAN, boxOf);
  assert.equal(curves.length, 6);
  const onDraft = [
    curves[0].p0,
    curves[1].p0,
    curves[2].p0, // departures, bottom of draft
    curves[3].p3,
    curves[4].p3,
    curves[5].p3, // arrivals, also the bottom of draft
  ];
  const xs = onDraft.map((p) => p.x);
  assert.equal(new Set(xs).size, 6, `every touch has its own spot: ${xs}`);
  for (const p of onDraft) {
    assert.equal(p.y, DRAFT.y + DRAFT.height, "all six meet the bottom face");
  }
});

test("routeEdges: an edge to a state above leaves the top, not the bottom", () => {
  const [, , , back] = routeEdges(FAN, boxOf);
  assert.equal(back.p0.y, CONFIRMED.y, "departs the top of confirmed");
  assert.equal(back.p3.y, DRAFT.y + DRAFT.height, "arrives at the bottom of draft");
});

test("routeEdges: the forward and back curve between two states are not the same line", () => {
  const [down, , , up] = routeEdges(FAN, boxOf);
  assert.notEqual(down.p0.x, up.p3.x, "they leave and arrive at different spots on draft");
  assert.notEqual(down.p3.x, up.p0.x, "and on confirmed");
});

test("routeEdges: attachments follow the direction of their other end", () => {
  const curves = routeEdges(FAN, boxOf);
  const toConfirmed = curves[0].p0.x; // draft → confirmed, which is to the left
  const toRevisit = curves[2].p0.x; // draft → needs_revisit, to the right
  assert.ok(toConfirmed < toRevisit, "an edge heading left leaves from further left");
});

test("routeEdges: a self-loop arcs off its own box instead of folding through it", () => {
  const [loop] = routeEdges([{ from: "draft", to: "draft" }], boxOf);
  assert.equal(loop.path, selfLoopCurve(DRAFT).path);
  assert.equal(loop.p0.x, DRAFT.x + DRAFT.width, "leaves the right edge");
  assert.ok(loop.p1.x > DRAFT.x + DRAFT.width, "and bulges away from the box");
});

test("routeEdges: a lone edge is routed exactly as edgeCurve draws it", () => {
  const [only] = routeEdges([{ from: "draft", to: "skipped" }], boxOf);
  assert.equal(only.path, edgeCurve(DRAFT, SKIPPED).path);
});

test("routeEdges: output is deterministic", () => {
  const a = routeEdges(FAN, boxOf).map((c) => c.path);
  const b = routeEdges(FAN, boxOf).map((c) => c.path);
  assert.deepEqual(a, b);
});

test("edgeCurve: the path drawn and the walker used agree at both ends", () => {
  const curve = edgeCurve(DRAFT, SKIPPED);
  assert.deepEqual(curve.at(0), { x: DRAFT.x + DRAFT.width / 2, y: DRAFT.y + DRAFT.height });
  assert.deepEqual(curve.at(1), { x: SKIPPED.x + SKIPPED.width / 2, y: SKIPPED.y });
  assert.ok(curve.path.startsWith(`M ${curve.p0.x} ${curve.p0.y} C `), curve.path);
  assert.ok(curve.path.endsWith(`${curve.p3.x} ${curve.p3.y}`), curve.path);
});
