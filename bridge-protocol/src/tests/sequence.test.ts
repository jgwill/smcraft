/**
 * SQDF (Spec 81): the document, its rules S001–S006, the pure edits, the
 * Mermaid render and the layout — on a small scenario and on the Episode 140
 * worked example.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  allMessages,
  emptySequence,
  isSequenceDefinition,
  isSqdfPath,
  messageRef,
  parseMessageRef,
  type SequenceDefinition,
} from "../sequence/definition.js";
import { validateSequence } from "../sequence/validate.js";
import {
  addFragment,
  addFragmentMessage,
  addMessage,
  addParticipant,
  moveMessage,
  removeFragment,
  removeMessage,
  removeParticipant,
  renameParticipant,
  moveParticipant,
  summarizeSequence,
  updateMessage,
  updateParticipant,
} from "../sequence/edit.js";
import { renderMermaidSequence } from "../render/mermaidSequence.js";
import { sequenceLayout } from "../sequence/layout.js";

const example = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../examples/wave-count/${name}`, import.meta.url)), "utf8"));

const ORDER: SequenceDefinition = {
  settings: { namespace: "demo", name: "PlaceOrder" },
  participants: [{ name: "Buyer", actor: "Buyer" }, { name: "Shop", service: "shop" }, { name: "Bank", service: "bank" }],
  messages: [
    { from: "Buyer", to: "Shop", label: "places order", event: "Place" },
    { from: "Shop", to: "Bank", label: "charges card", event: "Charge" },
    { from: "Bank", to: "Shop", label: "approved", event: "Approve", reply: true },
    { from: "Shop", to: "Buyer", label: "confirms", event: "Confirm" },
  ],
  fragments: [
    {
      kind: "alt",
      label: "card declined",
      after: 2,
      messages: [{ from: "Bank", to: "Shop", label: "declined", event: "Decline", reply: true }],
    },
  ],
};

test("a sequence is known by its extension and by its shape", () => {
  assert.equal(isSqdfPath("/x/order.sqdf.json"), true);
  assert.equal(isSqdfPath("/x/order.smdf.json"), false);
  assert.equal(isSequenceDefinition(ORDER), true);
  assert.equal(isSequenceDefinition({ entities: [], participants: [], messages: [] }), false);
  assert.equal(isSequenceDefinition({ state: {}, participants: [], messages: [] }), false);
  assert.deepEqual(emptySequence("d", "N"), { settings: { namespace: "d", name: "N" }, participants: [], messages: [] });
});

test("message addresses: main messages from 1, fragment messages as f<n>.<k>", () => {
  assert.equal(messageRef(null, 0), "1");
  assert.equal(messageRef(0, 1), "f1.2");
  assert.equal(parseMessageRef(ORDER, "3")?.message.label, "approved");
  assert.equal(parseMessageRef(ORDER, "f1.1")?.message.label, "declined");
  assert.equal(parseMessageRef(ORDER, "9"), null);
  assert.equal(parseMessageRef(ORDER, "f2.1"), null);
  assert.deepEqual(allMessages(ORDER).map((m) => m.ref), ["1", "2", "3", "4", "f1.1"]);
});

test("a well-formed sequence passes S001–S006", () => {
  assert.deepEqual(validateSequence(ORDER), []);
  assert.deepEqual(validateSequence(example("wave_count_to_entry.sqdf.json") as SequenceDefinition), []);
});

test("each rule names what is wrong", () => {
  const bad: SequenceDefinition = {
    settings: { namespace: "d", name: "" },
    participants: [{ name: "A" }, { name: "A" }, { name: "" }],
    messages: [{ from: "A", to: "Z", label: "" }],
    fragments: [
      { kind: "maybe" as never, label: "x", after: 0, messages: [] },
      { kind: "opt", label: "y", after: 5, messages: [] },
    ],
  };
  const ids = validateSequence(bad).map((e) => e.ruleId);
  for (const id of ["S001", "S002", "S003", "S004", "S005", "S006"]) assert.ok(ids.includes(id), `${id} in ${ids.join(",")}`);
  const s003 = validateSequence(bad).find((e) => e.ruleId === "S003");
  assert.match(s003!.message, /"Z", which is not a participant/);
});

test("inserting a message moves a later branch point with the message it follows", () => {
  const next = addMessage(ORDER, { from: "Buyer", to: "Shop", label: "adds a note" }, 1);
  assert.equal(next.messages[1].label, "adds a note");
  assert.equal(next.fragments![0].after, 3, "the alt still branches after 'charges card'");
  assert.equal(ORDER.fragments![0].after, 2, "input untouched");
  assert.equal(addMessage(ORDER, { from: "Buyer", to: "Shop", label: "last" }).fragments![0].after, 2);
});

test("removing a message moves a later branch point back", () => {
  const next = removeMessage(ORDER, 0);
  assert.equal(next.messages.length, 3);
  assert.equal(next.fragments![0].after, 1);
  assert.throws(() => removeMessage(ORDER, 9), /Message 10 not found/);
});

test("moving a message keeps each fragment on the message it branches after", () => {
  const next = moveMessage(ORDER, 1, 3);
  assert.deepEqual(next.messages.map((m) => m.label), ["places order", "approved", "confirms", "charges card"]);
  assert.equal(next.fragments![0].after, 4);
});

test("removing a participant takes its messages, as removing an entity takes its relationships", () => {
  const next = removeParticipant(ORDER, "Bank");
  assert.deepEqual(next.participants.map((p) => p.name), ["Buyer", "Shop"]);
  assert.deepEqual(next.messages.map((m) => m.label), ["places order", "confirms"]);
  assert.equal(next.fragments, undefined, "the alt held only Bank's message");
});

test("edits refuse what cannot be, and say what to do", () => {
  assert.throws(() => addParticipant(ORDER, { name: "Shop" }), /already exists/);
  assert.throws(() => addMessage(ORDER, { from: "Buyer", to: "Nobody", label: "x" }), /Participant 'Nobody' not found/);
  assert.throws(() => addMessage(ORDER, { from: "Buyer", to: "Shop", label: " " }), /needs a label/);
  assert.throws(() => addFragment(ORDER, { kind: "alt", label: "x", after: 7 }), /0 to 4/);
  assert.throws(() => addFragment(ORDER, { kind: "par" as never, label: "x", after: 1 }), /one of alt, opt, loop/);
  assert.throws(() => removeFragment(ORDER, 3), /Fragment 4 not found/);
});

test("updates merge, and an empty value clears", () => {
  const p = updateParticipant(ORDER, "Shop", { holds: ["Order"], service: "" });
  assert.deepEqual(p.participants[1], { name: "Shop", holds: ["Order"] });
  const m = updateMessage(ORDER, 0, { state: "Placed", event: "" });
  assert.deepEqual(m.messages[0], { from: "Buyer", to: "Shop", label: "places order", state: "Placed" });
  const f = addFragmentMessage(ORDER, 0, { from: "Shop", to: "Buyer", label: "sorry" });
  assert.equal(f.fragments![0].messages.length, 2);
  assert.match(summarizeSequence(ORDER), /^Buyer — actor Buyer$/m);
  assert.match(summarizeSequence(ORDER), /^f1\.1\. Bank → Shop: declined \(fires Decline\)$/m);
});

test("mermaid: participants, events after labels, an alt whose else holds the path it replaces", () => {
  const text = renderMermaidSequence(ORDER);
  assert.match(text, /^sequenceDiagram$/m);
  assert.match(text, /^  actor p1 as Buyer$/m);
  assert.match(text, /^  p1->>p2: 1 places order · Place$/m);
  assert.match(text, /^\s+p3-->>p2: 3 approved · Approve$/m, "a reply is dashed");
  const alt = text.indexOf("alt card declined");
  const elseAt = text.indexOf("else as written");
  assert.ok(alt > text.indexOf("2 charges card") && elseAt > alt && text.indexOf("3 approved") > elseAt);
  assert.match(text, /f1\.1 declined · Decline/);
});

test("mermaid: the Episode 140 scenario, optional message in its own opt", () => {
  const text = renderMermaidSequence(example("wave_count_to_entry.sqdf.json") as SequenceDefinition);
  assert.match(text, /opt optional\n\s+p1->>p4: 7 make a blueprint from this count · RequestBlueprint\n\s+end/);
  assert.match(text, /alt the market settles the count first/);
});

test("layout: a column per participant, a row per message, fragments framed below", () => {
  const L = sequenceLayout(ORDER);
  assert.equal(L.participants.length, 3);
  assert.ok(L.participants[0].x < L.participants[1].x && L.participants[1].x < L.participants[2].x);
  assert.deepEqual(L.rows.map((r) => r.ref), ["1", "2", "3", "4", "f1.1"]);
  const f = L.fragments[0];
  const fragRow = L.rows.find((r) => r.ref === "f1.1")!;
  assert.ok(fragRow.y > f.top && fragRow.y < f.top + f.height, "the fragment's message sits inside its frame");
  assert.ok(f.top > L.rows[3].y, "the frame comes after the main messages");
  assert.ok(L.lifelineBottom >= f.top + f.height);
  const self = sequenceLayout(example("wave_count_to_entry.sqdf.json") as SequenceDefinition).rows.find((r) => r.ref === "3")!;
  assert.equal(self.self, true);
});

test("renaming a participant renames it in every message; moving it changes only its column", () => {
  const r = renameParticipant(ORDER, "Bank", "Issuer");
  assert.deepEqual(r.participants.map((p) => p.name), ["Buyer", "Shop", "Issuer"]);
  assert.equal(r.messages[1].to, "Issuer");
  assert.equal(r.fragments![0].messages[0].from, "Issuer");
  assert.throws(() => renameParticipant(ORDER, "Bank", "Shop"), /already exists/);
  const m = moveParticipant(ORDER, "Bank", 0);
  assert.deepEqual(m.participants.map((p) => p.name), ["Bank", "Buyer", "Shop"]);
  assert.deepEqual(m.messages, ORDER.messages);
});

test("W4, W10: the layout survives malformed content and makes room for a self-message at the last column", () => {
  const bad = {
    settings: { namespace: "d", name: "Bad" },
    participants: [{ name: "A" }, {}, null],
    messages: [null, { from: "A", to: "A", label: 5 }, { from: "A", to: "Z", label: "to nobody" }],
    fragments: [null, { kind: "opt", label: "x", after: 9, messages: [null] }],
  } as unknown as SequenceDefinition;
  assert.doesNotThrow(() => sequenceLayout(bad));
  assert.deepEqual(sequenceLayout(bad).rows.map((r) => r.ref), ["2", "3"], "a null message keeps the numbering of the others");
  const lastSelf: SequenceDefinition = {
    settings: { namespace: "d", name: "S" },
    participants: [{ name: "A" }, { name: "B" }],
    messages: [{ from: "B", to: "B", label: "a rather long thing said to oneself at the edge" }],
  };
  const L = sequenceLayout(lastSelf);
  const row = L.rows[0];
  assert.ok(L.width >= row.fromX + 44, `width ${L.width} leaves room right of ${row.fromX}`);
  assert.ok(L.width > sequenceLayout({ ...lastSelf, messages: [] }).width);
});
