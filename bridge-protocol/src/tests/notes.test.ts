/**
 * Notes on a diagram and on its shapes: they survive the live diff/apply pair
 * in both directions — written, changed and erased — and `collectNotes` reads
 * them out of either document type.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDefinition } from "../diff.js";
import { applyPatchOps } from "../apply.js";
import { collectNotes } from "../notes.js";
import { addEntity, emptyErd, updateEntity, updateErdSettings } from "../index.js";
import type { StateMachineDefinition } from "../definition.js";

const base = (): StateMachineDefinition => ({
  settings: { namespace: "demo", name: "Loan", asynchronous: false },
  events: [{ name: "Desk", feeder: "Desk", events: [{ id: "Renew" }] }],
  state: { name: "Root", states: [{ name: "Out", states: [{ name: "Late" }] }, { name: "Returned", kind: "final" }] },
});

test("a note written on a state and on the diagram travels as a patch and lands", () => {
  const prev = base();
  const next = base();
  next.settings.notes = "Ask the desk about grace days.";
  next.state.states![0].states![0].notes = "Should Late block renewals?";
  const ops = diffDefinition(prev, next);
  assert.deepEqual(ops.map((o) => o.op).sort(), ["settings.update", "state.update"]);
  assert.deepEqual(applyPatchOps(prev, ops), next);
});

test("an erased note reaches the other side too, and leaves no empty key behind", () => {
  const prev = base();
  prev.settings.notes = "old";
  prev.state.states![0].notes = "old too";
  const next = base();
  const applied = applyPatchOps(prev, diffDefinition(prev, next));
  assert.deepEqual(applied, next);
  assert.ok(!("notes" in applied.settings) && !("notes" in applied.state.states![0]));
});

test("collectNotes reads the diagram note first, then every shape, nested ones included", () => {
  const def = base();
  def.settings.notes = "diagram";
  def.state.states![0].states![0].notes = "nested";
  def.state.states![1].notes = "   ";
  assert.deepEqual(collectNotes(def), [
    { target: null, notes: "diagram" },
    { target: "Late", notes: "nested" },
  ]);
});

test("an ERD carries notes the same way", () => {
  let erd = addEntity(emptyErd("demo", "Library"), { name: "Loan" });
  erd = updateErdSettings(erd, { notes: "Members vs patrons: pick one word." });
  erd = updateEntity(erd, "Loan", { notes: "Needs a due date." });
  assert.deepEqual(collectNotes(erd), [
    { target: null, notes: "Members vs patrons: pick one word." },
    { target: "Loan", notes: "Needs a due date." },
  ]);
  erd = updateEntity(updateErdSettings(erd, { notes: "" }), "Loan", { notes: " " });
  assert.deepEqual(collectNotes(erd), []);
  assert.ok(!("notes" in erd.settings) && !("notes" in erd.entities[0]));
});
