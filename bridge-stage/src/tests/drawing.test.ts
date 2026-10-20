/**
 * What the stage can draw, and the camera's path between two views.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDrawing, drawingLabel } from "../drawing.js";
import { lerpViewport, moveCamera } from "../camera.js";

const machine = { settings: { name: "M", namespace: "t" }, events: [], state: { name: "Root", states: [{ name: "A" }] } };

test("a wrapped or bare state machine loads; a system and junk say why not", () => {
  assert.equal(loadDrawing({ path: "m.smdf.json", doc: { stateMachine: machine } }).drawing?.kind, "machine");
  const bare = loadDrawing({ path: "m.smdf.json", doc: { state: machine.state } }).drawing;
  assert.equal(bare?.kind, "machine");
  assert.deepEqual(bare?.kind === "machine" ? bare.def.events : null, []);
  assert.match(loadDrawing({ path: "s.sysdf.json", doc: { settings: {}, members: [] } }).reason ?? "", /system/);
  assert.equal(loadDrawing({ path: "x.erdf.json", doc: { nope: true } }).drawing, null);
  assert.equal(loadDrawing({ path: "x.smdf.json", doc: null }).drawing, null);
});

test("a drawing is labelled by its file name without the format", () => {
  assert.equal(drawingLabel("diagrams/screenwalk-2026-10-01.sqdf.json"), "screenwalk-2026-10-01");
  assert.equal(drawingLabel("a.smdf.json"), "a");
});

test("the camera eases between two views and jumps where there is no frame clock", () => {
  const a = { x: 0, y: 0, scale: 1 };
  const b = { x: 100, y: -50, scale: 2 };
  assert.deepEqual(lerpViewport(a, b, 0), a);
  assert.deepEqual(lerpViewport(a, b, 1), b);
  const mid = lerpViewport(a, b, 0.5);
  assert.equal(mid.x, 50);
  let applied = null as null | typeof b;
  moveCamera(a, b, (v) => (applied = v));
  assert.deepEqual(applied, b);
});
