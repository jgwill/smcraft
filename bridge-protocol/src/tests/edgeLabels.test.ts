/**
 * Behaviour of the pure label settling — no DOM, no renderer.
 *
 * The shape under test is the one the guided-analysis sample produces and the
 * one the screenshots caught: a `draft` state fanning out to three siblings,
 * each of which sends an `advance_context` edge straight back. Six curves whose
 * midpoints crowd the same band, six chips that used to print on top of each
 * other.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  GUARD_MAX_CHARS,
  chipSize,
  guardText,
  overlaps,
  placeLabels,
  textWidth,
  type PendingLabel,
} from "../edgeLabels.js";
import { edgeCurve, routeEdges } from "../edgeRoutes.js";
import type { LayoutBox } from "../autoLayout.js";

const box = (x: number, y: number): LayoutBox => ({ x, y, width: 160, height: 60 });

/** draft above; confirmed / skipped / needs_revisit spread below it. */
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
const NODES = Object.values(BOXES);

/** The six transitions of the guided-analysis sample's `following` level. */
const FAN: { from: string; to: string; event: string; condition?: string }[] = [
  { from: "draft", to: "confirmed", event: "confirm_observation" },
  { from: "draft", to: "skipped", event: "skip_observation" },
  { from: "draft", to: "needs_revisit", event: "flag_needs_revisit" },
  { from: "confirmed", to: "draft", event: "advance_context", condition: "next context configured" },
  { from: "skipped", to: "draft", event: "advance_context", condition: "next context configured" },
  {
    from: "needs_revisit",
    to: "draft",
    event: "advance_context",
    condition: "next context configured",
  },
];

function fanOut(): (PendingLabel & { id: string })[] {
  const curves = routeEdges(FAN, boxOf);
  return FAN.map((edge, i) => ({
    id: `${edge.from}→${edge.to}`,
    event: edge.event,
    condition: edge.condition,
    at: curves[i].at,
  }));
}

test("textWidth: a chip grows with the words on it", () => {
  assert.ok(textWidth("advance_context", 11) > textWidth("go", 11));
  assert.equal(chipSize({ event: "go", at: () => ({ x: 0, y: 0 }) }).width, 56, "short ids floor");
  const long = chipSize({ event: "confirm_observation", at: () => ({ x: 0, y: 0 }) });
  assert.ok(
    long.width >= textWidth("confirm_observation", 11) + 16,
    `a plate must contain its own text, got ${long.width}`
  );
});

test("chipSize: a guard adds the second line, not extra words on the first", () => {
  const at = () => ({ x: 0, y: 0 });
  assert.equal(chipSize({ event: "advance_context", at }).height, 18);
  assert.equal(
    chipSize({ event: "advance_context", condition: "next context configured", at }).height,
    28
  );
});

test("guardText: a paragraph-long guard elides instead of widening the plate", () => {
  const at = () => ({ x: 0, y: 0 });
  const prose =
    "the return address matches where the seat actually sits, and the lease posture was read locally";
  const short = "next context configured";

  assert.equal(guardText(short), `[${short}]`, "a guard that fits is printed whole");
  assert.ok(guardText(prose).endsWith("…]"), "a guard that does not fit is elided");
  assert.ok(
    guardText(prose).length <= GUARD_MAX_CHARS + 3,
    `the drawn guard is bounded, got ${guardText(prose).length}`
  );

  // The chip is measured against what is drawn — a plate sized for the whole
  // sentence and printed with a stub would be padded with empty space.
  const elided = chipSize({ event: "VOICE_PUBLISHED", condition: prose, at });
  assert.ok(
    elided.width >= textWidth(guardText(prose), 9) + 16,
    "the plate still contains the text it prints"
  );
  assert.ok(
    elided.width < textWidth(`[${prose}]`, 9),
    `an elided guard must not size the plate to the full sentence, got ${elided.width}`
  );
});

test("placeLabels: six crowded chips settle without touching each other", () => {
  const placed = placeLabels(fanOut(), NODES);
  assert.equal(placed.length, 6, "no label is ever dropped");
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.ok(
        !overlaps(placed[i], placed[j]),
        `${placed[i].label.event} overlaps ${placed[j].label.event}`
      );
    }
  }
});

test("placeLabels: a chip does not park on a state box", () => {
  for (const spot of placeLabels(fanOut(), NODES)) {
    for (const node of NODES) {
      assert.ok(!overlaps(spot, node), `${spot.label.event} covers a state box`);
    }
  }
});

test("placeLabels: the payload rides through, so a caller can find its own edge", () => {
  const placed = placeLabels(fanOut(), NODES);
  const ids = new Set(placed.map((spot) => spot.label.id));
  assert.equal(ids.size, 6, "every pending label comes back exactly once");
  assert.ok(ids.has("draft→confirmed"));
});

test("placeLabels: an uncrowded label keeps the midpoint of its own curve", () => {
  const curve = edgeCurve(DRAFT, SKIPPED);
  const [spot] = placeLabels([{ event: "go", at: curve.at }], []);
  const mid = curve.at(0.5);
  assert.equal(spot.cx, mid.x);
  assert.equal(spot.cy, mid.y);
});

test("placeLabels: output is deterministic", () => {
  const a = placeLabels(fanOut(), NODES);
  const b = placeLabels(fanOut(), NODES);
  assert.deepEqual(
    a.map((s) => [s.label.event, s.x, s.y, s.width, s.height]),
    b.map((s) => [s.label.event, s.x, s.y, s.width, s.height])
  );
});

test("edgeCurve: the path drawn and the walker used agree at both ends", () => {
  const curve = edgeCurve(DRAFT, SKIPPED);
  const start = curve.at(0);
  const end = curve.at(1);
  assert.deepEqual(start, { x: DRAFT.x + DRAFT.width / 2, y: DRAFT.y + DRAFT.height });
  assert.deepEqual(end, { x: SKIPPED.x + SKIPPED.width / 2, y: SKIPPED.y });
  assert.ok(curve.path.startsWith(`M ${start.x} ${start.y} C `), curve.path);
  assert.ok(curve.path.endsWith(`${end.x} ${end.y}`), curve.path);
});
