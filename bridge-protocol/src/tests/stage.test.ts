/**
 * The stage and the marks as data (Spec 83): sidecar paths, the thread rules,
 * the tour checks, the boxes a layer over any canvas lights and hits, and the
 * review an agent reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMark,
  agentWordIn,
  agentWordText,
  isMarkUnread,
  markCounts,
  unreadMarks,
  withMarkRead,
  docKindOfPath,
  docPathOfMarks,
  elementAt,
  elementsInRegion,
  erdElementBoxes,
  formatReview,
  isLoomSidecar,
  isStageName,
  isTourDefinition,
  machineElementBoxes,
  marksPathOf,
  marksWaitingOn,
  newMarkId,
  readMarksFile,
  removeMark,
  replyToMark,
  resolveMark,
  resolveTourPaths,
  sequenceElementBoxes,
  sequenceLayout,
  stageRoom,
  stepDocs,
  stepHoldMs,
  validateTour,
  type MarkAuthor,
  type MarksFile,
  type SequenceDefinition,
  type TourDefinition,
} from "../index.js";

const person: MarkAuthor = { id: "guillaume", name: "Guillaume", role: "person" };
const agent: MarkAuthor = { id: "mia", name: "Mia", role: "agent" };
const AT = "2026-10-18T12:00:00.000Z";

test("a drawing's marks live beside it, one sidecar per drawing", () => {
  assert.equal(marksPathOf("/d/wave.smdf.json"), "/d/wave.smdf.marks.json");
  assert.equal(marksPathOf("/d/wave.erdf.json"), "/d/wave.erdf.marks.json");
  assert.equal(marksPathOf("/d/plain.json"), "/d/plain.marks.json");
  assert.equal(marksPathOf("/d/wave.smdf.marks.json"), "/d/wave.smdf.marks.json");
  assert.equal(docPathOfMarks("/d/wave.smdf.marks.json"), "/d/wave.smdf.json");
  assert.ok(isLoomSidecar("/d/wave.smdf.marks.json"));
  assert.ok(isLoomSidecar("/d/walk.tour.json"));
  assert.ok(!isLoomSidecar("/d/wave.smdf.json"));
  // A drawing's kind is untouched by the new suffixes.
  assert.equal(docKindOfPath("/d/wave.erdf.json"), "erd");
});

test("stage rooms are never file paths, and a bad name falls back to the default", () => {
  assert.equal(stageRoom("trading"), "stage:trading");
  assert.equal(stageRoom("../etc"), "stage:default");
  assert.ok(isStageName("ep-121.wave"));
  assert.ok(!isStageName(""));
  assert.ok(!isStageName("a b"));
});

test("a mark is made, answered by the other side, followed up, resolved and removed", () => {
  let file: MarksFile = { doc: "wave.smdf.json", marks: [] };
  file = addMark(file, { elements: ["state:Pending", "state:Pending", "state:Active"], text: " why does it stop? ", author: person }, AT, "m-1");
  const m = file.marks[0];
  assert.deepEqual(m.elements, ["state:Pending", "state:Active"]);
  assert.equal(m.text, "why does it stop?");
  assert.equal(m.status, "open");
  assert.deepEqual(marksWaitingOn(file.marks, "agent").map((x) => x.id), ["m-1"]);

  file = replyToMark(file, "m-1", { author: agent, text: "the guard reads a missing field" }, AT);
  assert.equal(file.marks[0].status, "answered");
  assert.deepEqual(marksWaitingOn(file.marks, "agent"), []);
  assert.deepEqual(marksWaitingOn(file.marks, "person").map((x) => x.id), ["m-1"]);

  file = replyToMark(file, "m-1", { author: person, text: "which field?" }, AT);
  assert.equal(file.marks[0].status, "open", "a follow-up from the asker opens it again");

  file = resolveMark(file, "m-1");
  file = replyToMark(file, "m-1", { author: agent, text: "wave_label" }, AT);
  assert.equal(file.marks[0].status, "resolved", "a reply does not reopen a resolved mark by itself");
  assert.equal(file.marks[0].replies?.length, 3);

  file = removeMark(file, "m-1");
  assert.equal(file.marks.length, 0);
  assert.throws(() => removeMark(file, "m-1"), /no mark/);
});

test("an agent's answer moves a mark to what waits on the person, and stays new until the thread is opened", () => {
  let file: MarksFile = { doc: "wave.smdf.json", marks: [] };
  file = addMark(file, { elements: ["state:A"], text: "why here?", author: person }, AT, "m-1");
  file = addMark(file, { elements: ["state:B"], text: "and here?", author: person }, AT, "m-2");
  assert.deepEqual(markCounts(file.marks), { forYou: 0, forAgent: 2, unread: 0 });

  file = replyToMark(file, "m-2", { author: agent, text: "the guard" }, AT);
  assert.deepEqual(markCounts(file.marks), { forYou: 1, forAgent: 1, unread: 1 }, "the answer counts for the person, not down to nothing");
  assert.deepEqual(unreadMarks(file.marks).map((m) => m.id), ["m-2"]);

  const word = agentWordIn({ marks: file.marks, change: { action: "reply", id: "m-2" } });
  assert.deepEqual(word && { action: word.action, number: word.number, name: word.name }, { action: "reply", number: 2, name: "Mia" });
  assert.equal(agentWordText(word!), "Mia answered mark 2");

  let read = withMarkRead({}, file.marks[1]);
  assert.equal(isMarkUnread(file.marks[1], read), false, "opened: read");
  file = replyToMark(file, "m-2", { author: person, text: "which guard?" }, AT);
  assert.equal(agentWordIn({ marks: file.marks, change: { action: "reply", id: "m-2" } }), null, "a person's reply is no agent's word");
  assert.equal(isMarkUnread(file.marks[1], read), false, "the person's own word is never new to them");
  file = replyToMark(file, "m-2", { author: agent, text: "wave_label" }, AT);
  assert.equal(isMarkUnread(file.marks[1], read), true, "a further answer is new again");
  read = withMarkRead(read, file.marks[1]);
  assert.deepEqual(unreadMarks(file.marks, read), []);

  // An agent's question is new and waits on the person; resolved threads never are.
  file = addMark(file, { elements: ["state:C"], text: "is C final?", author: agent }, AT, "m-3");
  assert.equal(agentWordText(agentWordIn({ marks: file.marks, change: { action: "add", id: "m-3" } })!), "Mia asked about mark 3");
  assert.deepEqual(unreadMarks(file.marks, read).map((m) => m.id), ["m-3"]);
  file = resolveMark(file, "m-3");
  assert.deepEqual(unreadMarks(file.marks, read), []);
  assert.equal(agentWordIn({ marks: file.marks, change: { action: "resolve", id: "m-3" } }), null);
  assert.equal(agentWordIn({ marks: file.marks }), null);
});

test("a mark refuses what it cannot point at", () => {
  const file: MarksFile = { doc: "x", marks: [] };
  assert.throws(() => addMark(file, { text: "  ", author: person }, AT), /text is empty/);
  assert.throws(() => addMark(file, { text: "x", elements: ["Pending"], author: person }, AT), /<kind>:<name>/);
  assert.throws(() => addMark(file, { text: "x", region: { x: 0, y: 0, width: 0, height: 4 }, author: person }, AT), /positive/);
  const ok = addMark(file, { text: "this area", region: { x: 1, y: 2, width: 30, height: 40 }, level: "Root", author: person }, AT, "m-2");
  assert.deepEqual(ok.marks[0].region, { x: 1, y: 2, width: 30, height: 40 });
});

test("a sidecar is read defensively: a broken entry is dropped, the rest kept", () => {
  const file = readMarksFile(
    { marks: [{ id: "m-a", text: "kept", kind: "nonsense", author: { name: "G" }, region: { x: 1 } }, { id: "", text: "no id" }, null, "x"] },
    "wave.smdf.json",
  );
  assert.equal(file.doc, "wave.smdf.json");
  assert.equal(file.marks.length, 1);
  assert.equal(file.marks[0].kind, "comment");
  assert.equal(file.marks[0].status, "open");
  assert.equal(file.marks[0].region, undefined);
  assert.deepEqual(file.marks[0].author, { id: "G", name: "G", role: "person" });
  assert.deepEqual(readMarksFile("garbage").marks, []);
});

test("mark ids sort by when they were made", () => {
  const a = newMarkId(1000, () => 0.5);
  const b = newMarkId(2000, () => 0.1);
  assert.ok(a < b);
  assert.match(a, /^m-[0-9a-z]+$/);
});

const tour: TourDefinition = {
  settings: { namespace: "jgt.trading", name: "Why the walk stops" },
  steps: [
    { doc: "wave.sqdf.json", focus: "message:9", say: "Here the scenario asks for a blueprint." },
    { spotlight: ["state:Published_Evaluating", "event:Evaluate"], say: "The machine refuses it in this state." },
    { doc: "/abs/wave.erdf.json", system: "wave.sysdf.json", region: { x: 0, y: 0, width: 300, height: 200 }, say: "And the data has no field for it.", holdMs: 0 },
  ],
};

test("a tour is checked step by step", () => {
  assert.deepEqual(validateTour(tour), []);
  assert.ok(isTourDefinition(tour));
  const bad = validateTour({
    settings: { namespace: "", name: "" },
    steps: [{ say: "", focus: "Pending", spotlight: ["state:A", "x"], region: { x: 0, y: 0, width: -1, height: 2 }, doc: "a.yaml", holdMs: -3, audio: "file.mp3" }],
  } as TourDefinition);
  assert.deepEqual(
    bad.map((e) => e.ruleId),
    ["T001", "T003", "T004", "T005", "T006", "T007", "T008", "T009"],
  );
  assert.deepEqual(validateTour({ settings: { namespace: "n", name: "t" }, steps: [{ say: "x", audio: "https://m/a.mp3" }, { say: "y", audio: "/api/voice/audio/k" }] }), []);
  assert.deepEqual(validateTour({ settings: { namespace: "n", name: "t" }, steps: [] }).map((e) => e.ruleId), ["T002"]);
});

test("a tour's paths resolve against the tour file, and a step without a doc stays where it was", () => {
  const resolved = resolveTourPaths(tour, "/work/trading/why.tour.json");
  assert.equal(resolved.steps[0].doc, "/work/trading/wave.sqdf.json");
  assert.equal(resolved.steps[1].doc, undefined);
  assert.equal(resolved.steps[2].doc, "/abs/wave.erdf.json");
  assert.equal(resolved.steps[2].system, "/work/trading/wave.sysdf.json");
  assert.deepEqual(stepDocs(resolved), ["/work/trading/wave.sqdf.json", "/work/trading/wave.sqdf.json", "/abs/wave.erdf.json"]);
});

test("a step stays as long as its words take to read, within bounds", () => {
  assert.equal(stepHoldMs({ say: "x", holdMs: 0 }), 0);
  assert.equal(stepHoldMs({ say: "short" }), 2500);
  const long = stepHoldMs({ say: Array.from({ length: 20 }, () => "word").join(" ") });
  assert.equal(long, 1200 + 20 * 400);
  assert.equal(stepHoldMs({ say: Array.from({ length: 500 }, () => "w").join(" ") }), 20000);
});

test("machine boxes: the level's states, and an event across its arrow's two ends", () => {
  const positions = {
    A: { x: 0, y: 0, width: 100, height: 40 },
    B: { x: 200, y: 0, width: 100, height: 40 },
    Deep: { x: 900, y: 900, width: 10, height: 10 },
  };
  const boxes = machineElementBoxes(
    [
      { name: "A", transitions: [{ event: "Go", nextState: "B" }, { event: "Out", nextState: "Elsewhere" }] },
      { name: "B" },
    ],
    positions,
  );
  assert.deepEqual(boxes.map((b) => b.focus), ["state:A", "state:B", "event:Go", "event:Out"]);
  assert.deepEqual(boxes[2].box, { x: 0, y: 0, width: 300, height: 40 });
  assert.deepEqual(boxes[3].box, positions.A, "an arrow leaving the level answers with its source");
  assert.equal(elementAt(boxes, 50, 20), "state:A", "the state wins over the event box around it");
  assert.deepEqual(elementsInRegion(boxes.filter((b) => b.focus.startsWith("state:")), { x: -10, y: -10, width: 150, height: 60 }), ["state:A"]);
});

test("ERD boxes: entities and their rows", () => {
  const def = {
    settings: { namespace: "n", name: "e" },
    entities: [{ name: "Wave", attributes: [{ name: "id", type: "uuid" }, { name: "label", type: "text" }] }],
    relationships: [],
  };
  const pos = { Wave: { x: 10, y: 20, width: 200, height: 78 } };
  const boxes = erdElementBoxes(def as never, pos);
  assert.deepEqual(boxes.map((b) => b.focus), ["entity:Wave", "attribute:Wave.id", "attribute:Wave.label"]);
  assert.deepEqual(boxes[2].box, { x: 10, y: 20 + 30 + 20, width: 200, height: 20 });
  assert.equal(elementAt(boxes, 50, 75), "attribute:Wave.label");
  const chen = erdElementBoxes(def as never, pos, { rows: false });
  assert.deepEqual(chen[1].box, pos.Wave);
});

test("sequence boxes: participants, messages, and the events they fire", () => {
  const def: SequenceDefinition = {
    settings: { namespace: "n", name: "s" },
    participants: [{ name: "Guillaume" }, { name: "Chart" }],
    messages: [
      { from: "Guillaume", to: "Chart", label: "count", event: "Count" },
      { from: "Chart", to: "Chart", label: "think" },
    ],
  };
  const layout = sequenceLayout(def);
  const boxes = sequenceElementBoxes(def, layout);
  const focuses = boxes.map((b) => b.focus);
  assert.ok(focuses.includes("participant:Guillaume"));
  assert.ok(focuses.includes("message:1"));
  assert.ok(focuses.includes("event:Count"));
  const row = layout.rows[0];
  assert.equal(elementAt(boxes, (row.fromX + row.toX) / 2, row.y), "message:1", "a message wins over the lifeline under it");
});

test("the review says what is on screen, then each mark and its thread", () => {
  let file: MarksFile = { doc: "wave.smdf.json", marks: [] };
  file = addMark(file, { elements: ["state:Pending"], text: "why here?", author: person }, AT, "m-1");
  file = replyToMark(file, "m-1", { author: agent, text: "a missing field" }, AT);
  const text = formatReview(
    { stage: "default", doc: "/d/wave.smdf.json", kind: "machine", focus: "state:Pending", who: "Guillaume", at: AT, tour: { index: 1, count: 3, playing: false, title: "Why" } },
    [{ doc: "/d/wave.smdf.json", marks: file.marks }],
  );
  assert.match(text, /Guillaume is on wave\.smdf\.json \(machine\), with state:Pending in hand\./);
  assert.match(text, /Tour 'Why' at step 2 of 3, paused\./);
  assert.match(text, /1\. \[answered · comment\] Guillaume on state:Pending \(wave\.smdf\.json\) — m-1/);
  assert.match(text, /↳ Mia \(agent\): "a missing field"/);
  assert.match(formatReview(null, []), /No canvas has said[\s\S]*No marks\./);
});
