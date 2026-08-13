/**
 * Behaviour of the trigger-glyph vocabulary and the room a chip reserves for it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_GLYPHS, SIGNAL_GLYPH, eventGlyph } from "../glyphs.js";
import { GLYPH_COLUMN, chipSize, glyphAt, placeLabels } from "../edgeLabels.js";

const at = () => ({ x: 200, y: 200 });

test("eventGlyph: the sample's events each get the mark that means them", () => {
  assert.equal(eventGlyph("confirm_observation").id, "confirm");
  assert.equal(eventGlyph("skip_observation").id, "skip");
  assert.equal(eventGlyph("flag_needs_revisit").id, "flag");
  assert.equal(eventGlyph("advance_context").id, "advance");
  assert.equal(eventGlyph("complete_sequence").id, "complete");
  assert.equal(eventGlyph("pause_follow").id, "pause");
  assert.equal(eventGlyph("resume_follow").id, "play");
});

test("eventGlyph: casing and camelCase read the same as snake_case", () => {
  assert.equal(eventGlyph("CONFIRM").id, "confirm");
  assert.equal(eventGlyph("confirmObservation").id, "confirm");
});

test("eventGlyph: an id the vocabulary knows nothing about falls back to signal", () => {
  assert.equal(eventGlyph("attach_browser").id, SIGNAL_GLYPH.id);
  assert.equal(eventGlyph("xyzzy").id, SIGNAL_GLYPH.id);
});

test("eventGlyph: every glyph is drawable — paths or circles, and a stroke weight", () => {
  for (const mark of ALL_GLYPHS) {
    assert.ok(mark.strokeWidth > 0, `${mark.id} has a stroke weight`);
    assert.ok(
      mark.paths.length > 0 || (mark.circles?.length ?? 0) > 0,
      `${mark.id} draws something`
    );
    for (const d of mark.paths) assert.match(d, /^[Mm]/, `${mark.id} path starts with a move`);
  }
});

test("chipSize: a glyph widens the plate by exactly its column", () => {
  const plain = chipSize({ event: "advance_context", at });
  const marked = chipSize({ event: "advance_context", at, glyph: true });
  assert.equal(marked.width - plain.width, GLYPH_COLUMN);
  assert.equal(marked.height, plain.height, "the glyph rides the first line, it does not add one");
});

test("placeLabels: the words re-centre in what the glyph column leaves", () => {
  const [plain] = placeLabels([{ event: "advance_context", at }], []);
  const [marked] = placeLabels([{ event: "advance_context", at, glyph: true }], []);
  assert.equal(plain.cx, plain.x + plain.width / 2, "no glyph: the text centres on the plate");
  assert.equal(
    marked.cx,
    marked.x + GLYPH_COLUMN + (marked.width - GLYPH_COLUMN) / 2,
    "glyph: the text centres on the plate minus the column"
  );
  assert.ok(marked.cx > marked.x + marked.width / 2, "which is right of the plate's own centre");
  const mark = glyphAt(marked);
  assert.ok(mark.x > marked.x && mark.x < marked.cx, "the mark sits left of the words");
  assert.ok(mark.y >= marked.y, "and inside the plate");
});
