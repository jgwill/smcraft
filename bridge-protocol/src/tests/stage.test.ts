/**
 * Tours and marks (what an agent shows, what a person points at) and the frame
 * a focus gives the camera.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TOUR_FORMAT,
  readTour,
  tourMembers,
  stepSpeech,
  readMarks,
  markFromDraft,
  markLine,
  describeMark,
} from "../stage/tour.js";
import { pathToState, machineStatesOf, machineFrame, erdFrame, sequenceFrame } from "../stage/frame.js";
import { autoLayout } from "../autoLayout.js";
import { sequenceLayout } from "../sequence/layout.js";
import type { StateMachineDefinition } from "../definition.js";
import type { SequenceDefinition } from "../sequence/definition.js";

const machine: StateMachineDefinition = {
  settings: { name: "Walk", namespace: "t" } as StateMachineDefinition["settings"],
  events: [],
  state: {
    name: "Root",
    states: [
      { name: "Idle", transitions: [{ event: "start", nextState: "Working" }] },
      {
        name: "Working",
        states: [
          { name: "Drafting", transitions: [{ event: "submit", nextState: "Review" }] },
          { name: "Review", transitions: [{ event: "approve", nextState: "Done" }] },
          { name: "Done", kind: "final" },
        ],
      },
    ],
  },
};

test("a tour carries its member forward and drops a bad focus without losing the step", () => {
  const { value, issues } = readTour({
    format: TOUR_FORMAT,
    title: "How a draft is reviewed",
    steps: [
      { member: "walk.smdf.json", focus: ["state:Idle"], text: "It starts idle." },
      { focus: ["state:Drafting", "nonsense"], text: "Then a draft.", say: "Then someone drafts." },
      { member: "walk.sqdf.json", focus: ["message:1"], text: "The scenario." },
    ],
  });
  assert.ok(value);
  assert.equal(value.steps[1].member, "walk.smdf.json");
  assert.deepEqual(value.steps[1].focus, ["state:Drafting"]);
  assert.match(issues.join("\n"), /nonsense/);
  assert.deepEqual(tourMembers(value), ["walk.smdf.json", "walk.sqdf.json"]);
  assert.equal(stepSpeech(value.steps[1]), "Then someone drafts.");
  assert.equal(stepSpeech(value.steps[0]), "It starts idle.");
});

test("a tour without a first member, a title or words is refused, and says why", () => {
  assert.equal(readTour({ title: "x", steps: [] }).value, null);
  const noMember = readTour({ title: "x", steps: [{ text: "hi" }] });
  assert.equal(noMember.value, null);
  assert.match(noMember.issues.join("\n"), /first step names a member/);
  assert.equal(readTour({ steps: [{ member: "a.smdf.json", text: "hi" }] }).value, null);
  assert.equal(readTour("not a tour").value, null);
});

test("a draft becomes an open mark, and a later line with its id answers it", () => {
  const { value: mark } = markFromDraft(
    { member: "walk.smdf.json", focus: ["state:Review"], kind: "question", note: "Who reviews?", by: "william", tour: "intro.tour.json", step: 2 },
    "m1",
    new Date("2026-10-20T03:00:00Z"),
  );
  assert.ok(mark);
  assert.equal(mark.status, "open");
  assert.equal(mark.at, "2026-10-20T03:00:00.000Z");
  assert.equal(
    describeMark(mark),
    "william: question on state:Review in walk.smdf.json during intro.tour.json step 3 — Who reviews?",
  );
  const answered = { ...mark, status: "answered" as const, answer: "Mia does, then you." };
  const { marks, issues } = readMarks(markLine(mark) + "\n{broken\n" + markLine(answered));
  assert.equal(marks.length, 1);
  assert.equal(marks[0].status, "answered");
  assert.equal(marks[0].answer, "Mia does, then you.");
  assert.deepEqual(issues, ["line 3: not JSON"]);
});

test("a mark refuses a path out of its folder and a mark that says and points at nothing", () => {
  const now = new Date();
  assert.equal(markFromDraft({ member: "../secrets.smdf.json", note: "x" }, "a", now).value, null);
  assert.equal(markFromDraft({ member: "/etc/x.smdf.json", note: "x" }, "a", now).value, null);
  assert.equal(markFromDraft({ member: "w.smdf.json", note: "  " }, "a", now).value, null);
  const pointOnly = markFromDraft({ member: "w.smdf.json", note: "", focus: ["state:Idle", "bad"] }, "a", now);
  assert.ok(pointOnly.value);
  assert.deepEqual(pointOnly.value.focus, ["state:Idle"]);
  assert.equal(pointOnly.value.kind, "note");
});

test("a nested state is framed inside its parent, with the drill path to it", () => {
  assert.deepEqual(pathToState(machine.state, "Review"), ["Working"]);
  assert.deepEqual(pathToState(machine.state, "Idle"), []);
  assert.equal(pathToState(machine.state, "Nowhere"), null);
  const positions = autoLayout(machine);
  const frame = machineFrame(machine, positions, ["state:Review", "state:Drafting"]);
  assert.deepEqual(frame.path, ["Working"]);
  assert.equal(frame.focused, true);
  assert.deepEqual(frame.boxes, [positions.Review, positions.Drafting]);
});

test("a transition and an event light the states at both ends", () => {
  assert.deepEqual(machineStatesOf(machine, ["transition:Idle:0"]), ["Idle", "Working"]);
  assert.deepEqual(machineStatesOf(machine, ["event:approve"]), ["Review", "Done"]);
  const missed = machineFrame(machine, autoLayout(machine), ["state:Nowhere"]);
  assert.equal(missed.focused, false);
  assert.deepEqual(missed.path, []);
  assert.equal(missed.boxes.length, 2);
});

test("an attribute frames its entity; nothing known frames every entity", () => {
  const positions = { A: { x: 0, y: 0, width: 10, height: 10 }, B: { x: 50, y: 0, width: 10, height: 10 } };
  assert.deepEqual(erdFrame(positions, ["attribute:B.id"]).boxes, [positions.B]);
  const none = erdFrame(positions, ["entity:C"]);
  assert.equal(none.focused, false);
  assert.equal(none.boxes.length, 2);
});

test("a message frames its row between the two lifelines", () => {
  const seq = {
    settings: { name: "S", namespace: "t" },
    participants: [{ name: "Person" }, { name: "Agent" }],
    messages: [{ from: "Person", to: "Agent", label: "asks" }],
  } as unknown as SequenceDefinition;
  const layout = sequenceLayout(seq);
  const frame = sequenceFrame(layout, ["message:1"]);
  assert.equal(frame.focused, true);
  const row = layout.rows[0];
  assert.ok(frame.boxes[0].x < Math.min(row.fromX, row.toX));
  assert.ok(frame.boxes[0].x + frame.boxes[0].width > Math.max(row.fromX, row.toX));
  assert.equal(sequenceFrame(layout, ["participant:Agent"]).boxes.length, 1);
});
