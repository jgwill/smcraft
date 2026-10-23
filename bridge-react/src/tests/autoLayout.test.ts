/**
 * Behaviour of the pure `autoLayout` derivation (no React, no DOM, no store).
 *
 * The fixture is the film post-production machine the designer runs live:
 * Ingest → Assembly → RoughCut → Review → ColorGrade → SoundMix → Master →
 * Released, with the `CHANGES_REQUESTED` loop back from Review to Assembly and
 * the QC branches from Master back into ColorGrade / SoundMix. Those loops are
 * exactly what a naive layout cannot survive, so they anchor the assertions:
 * layers must form, the loop must not push its target downward or raise a cycle,
 * and a state nobody transitions to must fall below the reachable machine
 * instead of crowding the first row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { StateDef, StateMachineDefinition } from "@miadi/stateloom-protocol";
import { autoLayout, type LayoutBox } from "../autoLayout.js";

const EVENT_IDS = [
  "MEDIA_VERIFIED",
  "SCENES_ASSEMBLED",
  "CUT_READY",
  "CHANGES_REQUESTED",
  "CUT_APPROVED",
  "GRADE_LOCKED",
  "MIX_LOCKED",
  "QC_PASSED",
  "QC_FAILED_PICTURE",
  "QC_FAILED_SOUND",
];

function filmMachine(extraStates: StateDef[] = []): StateMachineDefinition {
  return {
    settings: { namespace: "Film", name: "PostProduction", asynchronous: false },
    events: [{ name: "Internal", events: EVENT_IDS.map((id) => ({ id })) }],
    state: {
      name: "Root",
      states: [
        {
          name: "Ingest",
          kind: "normal",
          transitions: [{ event: "MEDIA_VERIFIED", nextState: "Assembly" }],
        },
        {
          name: "Assembly",
          kind: "normal",
          transitions: [{ event: "SCENES_ASSEMBLED", nextState: "RoughCut" }],
        },
        {
          name: "RoughCut",
          kind: "normal",
          transitions: [{ event: "CUT_READY", nextState: "Review" }],
        },
        {
          name: "Review",
          kind: "normal",
          transitions: [
            { event: "CHANGES_REQUESTED", nextState: "Assembly" },
            { event: "CUT_APPROVED", nextState: "ColorGrade" },
          ],
        },
        {
          name: "ColorGrade",
          kind: "normal",
          transitions: [{ event: "GRADE_LOCKED", nextState: "SoundMix" }],
        },
        {
          name: "SoundMix",
          kind: "normal",
          transitions: [{ event: "MIX_LOCKED", nextState: "Master" }],
        },
        {
          name: "Master",
          kind: "normal",
          transitions: [
            { event: "QC_PASSED", nextState: "Released" },
            { event: "QC_FAILED_PICTURE", nextState: "ColorGrade" },
            { event: "QC_FAILED_SOUND", nextState: "SoundMix" },
          ],
        },
        { name: "Released", kind: "final" },
        ...extraStates,
      ],
    },
  };
}

/** Distinct y bands, top-to-bottom — the layers as the canvas would read them. */
function layerBands(positions: Record<string, LayoutBox>, names: string[]): number[] {
  return [...new Set(names.map((n) => positions[n].y))].sort((a, b) => a - b);
}

const FILM_STATES = [
  "Ingest",
  "Assembly",
  "RoughCut",
  "Review",
  "ColorGrade",
  "SoundMix",
  "Master",
  "Released",
];

test("autoLayout: the film machine stacks into layers, not one flat row", () => {
  const positions = autoLayout(filmMachine());

  for (const name of FILM_STATES) {
    assert.ok(positions[name], `missing box for ${name}`);
    assert.ok(positions[name].width > 0 && positions[name].height > 0);
    assert.ok(positions[name].x >= 0 && positions[name].y >= 0);
  }

  const bands = layerBands(positions, FILM_STATES);
  assert.ok(bands.length >= 4, `expected >= 4 layers, got ${bands.length}`);

  // Ingest opens the machine; Released closes it.
  assert.equal(positions.Ingest.y, bands[0], "Ingest must sit in the first layer");
  assert.equal(
    positions.Released.y,
    bands[bands.length - 1],
    "Released must sit in the deepest layer"
  );
  for (const name of FILM_STATES) {
    if (name === "Ingest") continue;
    assert.ok(positions[name].y > positions.Ingest.y, `${name} should sit below Ingest`);
  }
  for (const name of FILM_STATES) {
    if (name === "Released") continue;
    assert.ok(
      positions[name].y < positions.Released.y,
      `${name} should sit above Released`
    );
  }
});

test("autoLayout: the Review → Assembly loop is a back edge, not a cycle error", () => {
  const positions = autoLayout(filmMachine());

  // A cycle would either throw or collapse the chain; instead the forward path
  // Ingest → Assembly → RoughCut → Review must keep descending.
  assert.ok(positions.Assembly.y > positions.Ingest.y);
  assert.ok(positions.RoughCut.y > positions.Assembly.y);
  assert.ok(positions.Review.y > positions.RoughCut.y);
  // The loop target stays above its source — the edge draws upward, and never
  // drags Assembly below Review.
  assert.ok(positions.Assembly.y < positions.Review.y);

  // Same for the Master QC branches back into the finishing stages.
  assert.ok(positions.ColorGrade.y < positions.Master.y);
  assert.ok(positions.SoundMix.y < positions.Master.y);
});

test("autoLayout: siblings in one layer never overlap horizontally", () => {
  const positions = autoLayout(filmMachine());
  const byBand = new Map<number, LayoutBox[]>();
  for (const name of FILM_STATES) {
    const box = positions[name];
    const list = byBand.get(box.y);
    if (list) list.push(box);
    else byBand.set(box.y, [box]);
  }
  for (const [, boxes] of byBand) {
    const sorted = [...boxes].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].x >= sorted[i - 1].x + sorted[i - 1].width,
        "boxes in the same layer must not overlap"
      );
    }
  }
});

test("autoLayout: output is deterministic", () => {
  const a = autoLayout(filmMachine());
  const b = autoLayout(filmMachine());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "key order must be stable too");
});

test("autoLayout: a disconnected state lands in a trailing layer", () => {
  const positions = autoLayout(
    filmMachine([{ name: "Archive", kind: "normal" }])
  );
  assert.ok(positions.Archive, "disconnected state must still be placed");
  assert.ok(
    positions.Archive.y > positions.Released.y,
    "an unreachable state belongs below the reachable machine"
  );
  // …and the reachable machine is unchanged by its presence.
  const bare = autoLayout(filmMachine());
  for (const name of FILM_STATES) {
    assert.deepEqual(positions[name], bare[name], `${name} moved because of Archive`);
  }
});

test("autoLayout: composite children are arranged inside their parent's anchor", () => {
  const def: StateMachineDefinition = {
    settings: { namespace: "Nest", asynchronous: false },
    events: [{ name: "Internal", events: [{ id: "GO" }, { id: "DEEP" }] }],
    state: {
      name: "Root",
      states: [
        { name: "Start", transitions: [{ event: "GO", nextState: "Work" }] },
        {
          name: "Work",
          states: [
            { name: "Inner1", transitions: [{ event: "DEEP", nextState: "Inner2" }] },
            { name: "Inner2" },
          ],
        },
      ],
    },
  };

  const positions = autoLayout(def);
  assert.equal(positions.Work.width, 300, "a composite keeps the designer's box size");
  assert.equal(positions.Work.height, 200);
  assert.ok(positions.Inner1 && positions.Inner2);
  // Children are anchored inside the parent and layered, not strung out sideways.
  assert.ok(positions.Inner1.y >= positions.Work.y);
  assert.ok(positions.Inner2.y > positions.Inner1.y);
  // Root's bounding box wraps everything at the top level.
  assert.ok(positions.Root.x <= positions.Start.x);
  assert.ok(positions.Root.y <= positions.Start.y);
});

test("autoLayout: options tune pitch and anchor without changing the ordering", () => {
  const tight = autoLayout(filmMachine(), {
    hSpacing: 300,
    vSpacing: 200,
    originX: 0,
    originY: 0,
  });
  const bands = layerBands(tight, FILM_STATES);
  assert.equal(bands[0], 0, "originY anchors the first layer");
  assert.equal(bands[1] - bands[0], 200, "vSpacing sets the layer pitch");
  assert.ok(Math.min(...FILM_STATES.map((n) => tight[n].x)) >= 0);
});
