/**
 * Marks in the person's words (Spec 83, lane U finding U12; Spec 84, U1): elements by the
 * names the board shows, what a mark points at, where it stands, and a summary of an
 * episode's marks for a conversation that has no take yet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drawingName, elementName, markPlace, markStanding, markedNames, marksSummary, namesText } from "../names.js";

test("an element is named as the board shows it", () => {
  assert.equal(elementName("state:Witnessing"), "Witnessing");
  assert.equal(elementName("event:NameSessions"), "NameSessions");
  assert.equal(elementName("entity:WaveCount"), "WaveCount");
  assert.equal(elementName("attribute:WaveCount.id"), "id in WaveCount");
  assert.equal(elementName("message:8"), "message 8");
  assert.equal(elementName("message:8", { "message:8": "8. upload the closing" }), "8. upload the closing", "the host's words win");
  assert.equal(elementName("plain"), "plain");
});

test("what a mark points at: its names, an entity's attributes left to the entity", () => {
  assert.deepEqual(markedNames(["entity:Screenwalk", "attribute:Screenwalk.state", "attribute:Review.id"]), ["Screenwalk", "id in Review"]);
  assert.equal(namesText(["A"]), "A");
  assert.equal(namesText(["A", "B"]), "A and B");
  assert.equal(namesText(["A", "B", "C"]), "A, B and C");
  assert.equal(namesText(["A", "B", "C", "D", "E", "F"]), "A, B and 4 more");
  const six = ["state:NotStarted", "state:Recording", "state:Witnessing", "event:StartRecording", "event:NameSessions", "event:ClosingWritten"];
  assert.equal(markPlace({ elements: six, region: { x: 233, y: 128, width: 258, height: 354 }, level: "Root" }), "NotStarted, Recording and 4 more");
  assert.equal(markPlace({ elements: [], region: { x: 0, y: 0, width: 5, height: 5 }, level: "Root" }), "an area");
  assert.equal(markPlace({ region: { x: 0, y: 0, width: 5, height: 5 }, level: "Recording" }), "an area inside Recording");
  assert.equal(markPlace({}), "the drawing");
});

test("a drawing by its own name, else its file without the format", () => {
  assert.equal(drawingName("/e/diagrams/screenwalk.smdf.json", "Screenwalk"), "Screenwalk");
  assert.equal(drawingName("/e/diagrams/screenwalk.erdf.json"), "screenwalk");
  assert.equal(drawingName(null), "the drawing");
});

test("where a mark stands, and the summary the conversation shows when nothing was said by voice", () => {
  const person = { name: "Guillaume", role: "person" };
  const agent = { name: "Mia", role: "agent" };
  assert.equal(markStanding({ status: "open", author: person }), "waits for agent");
  assert.equal(markStanding({ status: "answered", author: person }), "answered");
  assert.equal(markStanding({ status: "open", author: agent }), "waits for you");
  assert.equal(markStanding({ status: "answered", author: agent }), "waits for agent");
  assert.equal(markStanding({ status: "resolved", author: person }), "resolved");
  const machine = { doc: "/e/diagrams/screenwalk.smdf.json", title: "Screenwalk", author: person };
  const marks = [
    ...Array.from({ length: 6 }, () => ({ ...machine, status: "answered" })),
    { ...machine, status: "resolved" },
    { doc: "/e/diagrams/screenwalk.erdf.json", title: "ScreenwalkRecords", author: person, status: "open" },
  ];
  assert.equal(marksSummary(marks, "Mia"), "7 marks on Screenwalk, 6 answered, 1 resolved; 1 mark on ScreenwalkRecords, 1 waiting on Mia");
});
