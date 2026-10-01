/**
 * SYSDF (Spec 82): the system document, `checkSystem` (Y, L005–L008), the
 * replay, reconcile (the scenario upgrades the machine), and `systemLinks` —
 * on small machines and on the Episode 140 worked example.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StateMachineDefinition } from "../definition.js";
import type { SequenceDefinition } from "../sequence/definition.js";
import {
  docKindOfContent,
  docKindOfPath,
  emptySystem,
  isSystemDefinition,
  relativeMemberPath,
  resolveMemberPath,
  type SystemDefinition,
} from "../system/definition.js";
import { addActor, addMember, removeMember, summarizeSystem, updateMember } from "../system/edit.js";
import { checkSystem, linksOf, parseFocus, systemLinks, type LoadedMember } from "../system/check.js";
import { formatReplay, replayScenario } from "../system/replay.js";
import { reconcileScenario } from "../system/reconcile.js";
import { applyPatchOps } from "../apply.js";

const dir = fileURLToPath(new URL("../../../examples/wave-count/", import.meta.url));
const read = (name: string): unknown => JSON.parse(readFileSync(dir + name, "utf8"));
const SYSTEM = read("elliott_wave_count.sysdf.json") as SystemDefinition;
const loadAll = (): LoadedMember[] =>
  SYSTEM.members.map((m) => ({ path: m.path, kind: docKindOfPath(m.path), def: read(m.path) }));
const LIFECYCLE = read("elliott_wave_count.smdf.json") as StateMachineDefinition;
const SCENARIO = read("wave_count_to_entry.sqdf.json") as SequenceDefinition;

/** Door: Closed ⇄ Open, Locked under Closed; Broken is final. `Kick` is handled on the composite. */
const DOOR: StateMachineDefinition = {
  settings: { namespace: "demo", name: "Door", asynchronous: false },
  events: [{ name: "Hand", events: [{ id: "Open" }, { id: "Close" }, { id: "Lock" }, { id: "Unlock" }, { id: "Kick" }, { id: "Try" }] }],
  state: {
    name: "Root",
    states: [
      {
        name: "Shut",
        transitions: [{ event: "Kick", nextState: "Broken" }],
        states: [
          { name: "Closed", transitions: [{ event: "Open", nextState: "Opened" }, { event: "Lock", nextState: "Locked" }] },
          { name: "Locked", transitions: [{ event: "Unlock", nextState: "Closed" }] },
        ],
      },
      {
        name: "Opened",
        transitions: [
          { event: "Close", nextState: "Closed" },
          { event: "Try", nextState: "Closed", condition: "door.stuck" },
          { event: "Try", nextState: "Broken", condition: "door.rotten" },
        ],
      },
      { name: "Broken", kind: "final" },
    ],
  },
};

const story = (messages: SequenceDefinition["messages"]): SequenceDefinition => ({
  settings: { namespace: "demo", name: "Story" },
  participants: [{ name: "Person" }, { name: "Door", object: "door" }],
  messages,
});
const says = (event: string, extra: Partial<SequenceDefinition["messages"][number]> = {}) => ({
  from: "Person",
  to: "Door",
  label: event.toLowerCase(),
  event,
  ...extra,
});

test("a document's kind is its extension, and its shape when only content is at hand", () => {
  assert.equal(docKindOfPath("a.sysdf.json"), "system");
  assert.equal(docKindOfPath("a.sqdf.json"), "sequence");
  assert.equal(docKindOfPath("a.erdf.json"), "erd");
  assert.equal(docKindOfPath("a.smdf.json"), "machine");
  assert.equal(docKindOfPath("statemachine.json"), "machine");
  assert.equal(docKindOfContent(SYSTEM), "system");
  assert.equal(docKindOfContent(SCENARIO), "sequence");
  assert.equal(docKindOfContent(LIFECYCLE), "machine");
  assert.equal(isSystemDefinition(emptySystem("d", "S")), true);
});

test("member paths are relative to the system file", () => {
  assert.equal(resolveMemberPath("/b/diagrams/x.sysdf.json", "y.erdf.json"), "/b/diagrams/y.erdf.json");
  assert.equal(resolveMemberPath("/b/diagrams/x.sysdf.json", "../other/z.smdf.json"), "/b/other/z.smdf.json");
  assert.equal(resolveMemberPath("/b/diagrams/x.sysdf.json", "/abs/w.sqdf.json"), "/abs/w.sqdf.json");
  assert.equal(relativeMemberPath("/b/diagrams/x.sysdf.json", "/b/diagrams/sub/y.erdf.json"), "sub/y.erdf.json");
  assert.equal(relativeMemberPath("/b/diagrams/x.sysdf.json", "/elsewhere/y.erdf.json"), "/elsewhere/y.erdf.json");
});

test("a system holds data, machines and scenarios — never another system", () => {
  const s = addMember(emptySystem("d", "S"), { path: "a.erdf.json" });
  assert.throws(() => addMember(s, { path: "a.erdf.json" }), /already a member/);
  assert.throws(() => addMember(s, { path: "b.sysdf.json" }), /not a loom document a system can hold/);
  assert.throws(() => addMember(s, { path: "notes.md" }), /not a loom document/);
  assert.throws(() => removeMember(s, "zz.smdf.json"), /not a member/);
  assert.throws(() => addActor(s, { name: "X", kind: "robot" as never }), /person, agent, service, external/);
  assert.match(summarizeSystem(addActor(s, { name: "Ann", kind: "person" })), /actor person: Ann/);
});

test("the Episode 140 system: no errors, and the two findings the proposal page named", () => {
  const { issues, replays } = checkSystem(SYSTEM, loadAll());
  const errors = issues.filter((i) => i.severity === "error");
  assert.deepEqual(errors, []);
  const warnings = issues.filter((i) => i.severity === "warning").map((i) => i.message);
  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings[0], /without optional messages, message 9: .*"Authorize" from Published_Tradable \(2 later messages stop too\) — .*may not be optional/);
  assert.match(warnings[1], /alt 1 · the market settles the count first, message f1\.1: .*"InvalidationReached" from StrategicEntry/);
  assert.equal(replays.length, 1);
});

test("the Episode 140 main path walks seven transitions to StrategicEntry", () => {
  const report = replayScenario(SCENARIO, [LIFECYCLE]);
  const main = report.paths.find((p) => p.kind === "main")!;
  assert.equal(main.accepted, true);
  const moves = main.steps.filter((s) => s.result === "moved");
  assert.deepEqual(moves.map((s) => s.ref), ["1", "4", "6", "7", "9", "10", "11"]);
  assert.deepEqual(main.end.ElliottWaveCountLifecycle, ["StrategicEntry"]);
  const six = moves.find((s) => s.ref === "6")!;
  assert.deepEqual(six.to, ["Published_Tradable"], "the message's state picks between the two guarded transitions");
  assert.deepEqual(six.guards, ["count.wave_label in TRADABLE_LABELS"]);
  assert.match(formatReplay(report), /11\. StrategyCreated @ElliottWaveCountLifecycle: Mandate_Delegating → StrategicEntry moved/);
});

test("replay: an event is looked up on the leaf, then on each ancestor", () => {
  const main = replayScenario(story([says("Lock"), says("Kick")]), [DOOR]).paths[0];
  assert.deepEqual(main.steps.map((s) => [s.from[0], s.to[0], s.result]), [
    ["Closed", "Locked", "moved"],
    ["Locked", "Broken", "moved"],
  ]);
});

test("replay: a final state ends the machine; later events are reported as ended", () => {
  const main = replayScenario(story([says("Kick"), says("Unlock")]), [DOOR]).paths[0];
  assert.equal(main.steps[1].result, "ended");
  assert.equal(main.accepted, false);
});

test("replay: unknown guards keep every possible state, and the next message decides", () => {
  const main = replayScenario(story([says("Open"), says("Try"), says("Lock")]), [DOOR]).paths[0];
  assert.deepEqual(main.steps[1].to.sort(), ["Broken", "Closed"]);
  assert.deepEqual(main.steps[2].to, ["Locked"], "only Closed accepts Lock, so the walk was in Closed");
  assert.equal(main.accepted, true);
});

test("replay: a state claim the machine cannot meet is a mismatch", () => {
  const main = replayScenario(story([says("Open", { state: "Locked" })]), [DOOR]).paths[0];
  assert.equal(main.steps[0].result, "state-mismatch");
  assert.match(main.steps[0].note!, /says Door is in Locked; the walk has it in Opened/);
  const composite = replayScenario(story([says("Lock", { state: "Shut" })]), [DOOR]).paths[0];
  assert.equal(composite.steps[0].result, "moved", "a composite claim holds for any leaf beneath it");
});

test("replay: alt replaces what follows its branch point, opt and loop insert", () => {
  const seq: SequenceDefinition = {
    ...story([says("Open"), says("Close"), says("Lock")]),
    fragments: [
      { kind: "alt", label: "kicked instead", after: 1, messages: [says("Kick")] },
      { kind: "loop", label: "fidgeting", after: 1, messages: [says("Close"), says("Open")] },
    ],
  };
  const r = replayScenario(seq, [DOOR]);
  const alt = r.paths.find((p) => p.kind === "alt")!;
  assert.deepEqual(alt.steps.map((s) => s.ref), ["1", "f1.1"]);
  assert.equal(alt.steps[1].result, "refused", "Kick is handled under Shut, and the door is Opened");
  const loop = r.paths.find((p) => p.kind === "loop")!;
  assert.deepEqual(loop.steps.map((s) => s.ref), ["1", "f2.1", "f2.2", "f2.1", "f2.2", "2", "3"]);
  assert.equal(loop.accepted, true);
});

test("check: L005, L006 and L007 name what the scenario asks for and the system lacks", () => {
  const members = loadAll();
  const seq = structuredClone(SCENARIO);
  seq.participants.push({ name: "Ghost", actor: "Nobody", object: "phantom", holds: ["Unicorn"] });
  seq.messages.push({ from: "Ghost", to: "Market", label: "haunts", event: "Haunt", carries: "Ectoplasm" });
  seq.messages.push({ from: "Ghost", to: "Market", label: "again", event: "LabelWave", machine: "NoSuchMachine" });
  members[2] = { ...members[2], def: seq };
  const errors = checkSystem(SYSTEM, members).issues.filter((i) => i.severity === "error").map((i) => `${i.ruleId} ${i.message}`);
  assert.ok(errors.includes('L006 Participant "Ghost" is the actor "Nobody", which the system does not list'));
  assert.ok(errors.includes('L006 Participant "Ghost" is the object "phantom", which no member machine declares'));
  assert.ok(errors.includes('L006 Participant "Ghost" holds "Unicorn", which is not an entity'));
  assert.ok(errors.includes('L005 Message 14 fires "Haunt", which no member machine defines'));
  assert.ok(errors.includes('L007 Message 14 carries "Ectoplasm", which is not an entity'));
  assert.ok(errors.includes('L005 Message 15 names the machine "NoSuchMachine", which is not a member'));
});

test("check: Y rules for the system document and unreadable members", () => {
  const bad: SystemDefinition = {
    settings: { namespace: "", name: "S" },
    members: [{ path: "a.smdf.json" }, { path: "a.smdf.json" }, { path: "x.sysdf.json" }],
    actors: [{ name: "A", kind: "person" }, { name: "A", kind: "person" }],
  };
  const members: LoadedMember[] = [
    { path: "a.smdf.json", kind: "machine", def: null, error: "ENOENT" },
    { path: "b.erdf.json", kind: "erd", def: DOOR },
  ];
  const ids = checkSystem(bad, members).issues.map((i) => `${i.ruleId} ${i.message}`);
  assert.ok(ids.includes("Y001 The system has no settings.namespace"));
  assert.ok(ids.includes('Y002 "a.smdf.json" is listed twice'));
  assert.ok(ids.some((m) => m.startsWith('Y002 "x.sysdf.json" is not a document a system holds')));
  assert.ok(ids.includes('Y004 Duplicate actor "A"'));
  assert.ok(ids.includes('Y003 "a.smdf.json" cannot be read: ENOENT'));
  assert.ok(ids.includes('Y003 "b.erdf.json" is named as a erd but holds machine'));
});

test("reconcile: a new event and a new state in the scenario become the machine's", () => {
  const seq = story([says("Open"), says("Slam", { state: "Cracked" })]);
  const result = reconcileScenario(seq, [DOOR]);
  assert.equal(result.before.accepted, false);
  assert.equal(result.after.accepted, true);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(result.proposals[0].ops, [
    { op: "eventSource.add", source: { name: "PersonEvents", events: [{ id: "Slam" }] } },
    { op: "state.add", parent: null, state: { name: "Cracked", transitions: [] } },
    { op: "transition.add", state: "Opened", transition: { event: "Slam", nextState: "Cracked" } },
  ]);
  assert.match(result.proposals[0].reasons[1], /goes from Opened to Cracked on "Slam", because message 2 \(main\) says so/);
  const applied = applyPatchOps(DOOR, result.proposals[0].ops);
  assert.deepEqual(applied, result.machines[0], "the ops are exactly what the returned machine holds");
  assert.equal(replayScenario(seq, [applied]).accepted, true);
  assert.equal(DOOR.events.length, 1, "input untouched");
});

test("reconcile: an existing source named after the sender takes the event", () => {
  const seq: SequenceDefinition = { ...story([says("Wave", { state: "Opened" })]), participants: [{ name: "Hand" }, { name: "Door" }] };
  seq.messages[0].from = "Hand";
  const ops = reconcileScenario(seq, [DOOR]).proposals[0].ops;
  assert.deepEqual(ops[0], { op: "event.add", sourceIndex: 0, event: { id: "Wave" } });
});

test("reconcile: what the scenario does not say is left for a person", () => {
  const r = reconcileScenario(story([says("Kick"), says("Open")]), [DOOR]);
  assert.deepEqual(r.proposals, []);
  assert.equal(r.unresolved.length, 1);
  assert.match(r.unresolved[0], /Door ended in Broken/);
  const refusal = reconcileScenario(story([says("Unlock")]), [DOOR]);
  assert.match(refusal.unresolved[0], /refuses "Unlock" from Closed; give the message a state/);
  const mismatch = reconcileScenario(story([says("Open", { state: "Locked" })]), [DOOR]);
  assert.match(mismatch.unresolved[0], /that is a person's call/);
  const ambiguous = reconcileScenario(story([says("Open"), says("Try"), says("Wave", { state: "Opened" })]), [DOOR]);
  assert.ok(ambiguous.unresolved.some((u) => /could be in (Closed or Broken|Broken or Closed)/.test(u)) || ambiguous.proposals.length === 1);
});

test("reconcile: the Episode 140 findings are left open, and the optional message is named", () => {
  const r = reconcileScenario(SCENARIO, [LIFECYCLE]);
  assert.deepEqual(r.proposals, [], "nothing in the worked example says how to fix it");
  assert.match(r.unresolved[0], /without its optional message 7 the scenario stops/);
  assert.match(r.unresolved[1], /refuses "InvalidationReached" from StrategicEntry/);
});

test("links: the crossings a canvas follows, read from either side", () => {
  const links = systemLinks(loadAll());
  const has = (rule: string, from: string, to: string) =>
    links.some((l) => l.rule === rule && `${l.from.kind}:${l.from.name}` === from && `${l.to.kind}:${l.to.name}` === to);
  assert.ok(has("L001", "object:count", "entity:WaveCount"));
  assert.ok(has("L002", "event:CountEvaluated", "attribute:WaveCount.wave_label"));
  assert.ok(has("L003", "attribute:WaveCount.reading_state", "machine:ElliottWaveCountLifecycle"));
  assert.ok(has("L005", "message:9", "event:Authorize"));
  assert.ok(has("L006", "participant:Market", "object:market"));
  assert.ok(has("L006", "participant:Analysis", "entity:WaveCount"));
  assert.ok(has("L007", "message:9", "entity:CampaignMandate"));
  assert.ok(has("L008", "message:11", "state:StrategicEntry"));
  const ofCount = linksOf(links, "elliott_wave_count.erdf.json", "entity:WaveCount");
  assert.ok(ofCount.some((l) => l.other.kind === "object" && l.text === "is the class of ElliottWaveCountLifecycle's object count"));
  assert.ok(ofCount.some((l) => l.other.kind === "message" && l.other.name === "5"));
  assert.deepEqual(parseFocus("message:f1.2"), { kind: "message", name: "f1.2" });
  assert.equal(parseFocus("nonsense"), null);
});

// ── reconcileSystem and the mode (Guillaume, 2026-09-30: "without validation … a modality") ──

import { reconcileSystem, summarizeReconcile } from "../system/reconcileSystem.js";
import { reconcileModeOf } from "../system/definition.js";
import { setReconcileMode } from "../system/edit.js";

test("the mode: propose unless the system or an override says auto", () => {
  assert.equal(reconcileModeOf(SYSTEM), "propose");
  const auto = setReconcileMode(SYSTEM, "auto");
  assert.equal(reconcileModeOf(auto), "auto");
  assert.equal(reconcileModeOf(auto, "propose"), "propose", "a session override wins");
  assert.equal(reconcileModeOf(null, "auto"), "auto");
  assert.equal(reconcileModeOf(auto, "nonsense"), "auto", "an unknown override is ignored");
  assert.throws(() => setReconcileMode(SYSTEM, "yolo" as never), /propose or auto/);
});

test("reconcileSystem: one scenario edit reaches the machine, the data and the actors", () => {
  const members = loadAll();
  const seq = structuredClone(SCENARIO);
  seq.participants.push({ name: "Risk", actor: "Risk officer", holds: ["RiskLimit"] });
  seq.messages.push({
    from: "Risk", to: "Blueprint", label: "halts the mandate", event: "RiskHalt", state: "Halted", carries: "HaltNotice",
  });
  members[2] = { ...members[2], def: seq };
  const r = reconcileSystem(SYSTEM, members);

  assert.equal(r.system?.def.actors?.some((a) => a.name === "Risk officer" && a.kind === "person"), true);
  const erd = r.erds[0];
  assert.deepEqual(
    erd.def.entities.filter((e) => ["RiskLimit", "HaltNotice"].includes(e.name)).map((e) => e.name),
    ["RiskLimit", "HaltNotice"],
  );
  assert.match(erd.def.entities.find((e) => e.name === "HaltNotice")!.notes!, /message 14 of WaveCountToEntry carries it/);

  const m = r.machines[0];
  assert.equal(m.machine, "ElliottWaveCountLifecycle");
  assert.deepEqual(m.ops.map((o) => o.op), ["eventSource.add", "state.add", "transition.add"]);
  assert.deepEqual(m.ops[2], { op: "transition.add", state: "StrategicEntry", transition: { event: "RiskHalt", nextState: "Halted" } });

  // Applied, the system checks with no new error, and the new message walks.
  const after = members.map((x) =>
    x.kind === "machine" ? { ...x, def: m.def } : x.kind === "erd" ? { ...x, def: erd.def } : x,
  );
  const check = checkSystem(r.system!.def, after);
  assert.deepEqual(check.issues.filter((i) => i.severity === "error"), []);
  const main = check.replays[0].report.paths.find((p) => p.kind === "main")!;
  assert.equal(main.steps.find((s) => s.ref === "14")?.result, "moved");

  assert.equal(summarizeReconcile(r, "auto").startsWith("auto: ElliottWaveCountLifecycle +2, ElliottWaveCountData +2, system +1; "), true);
  assert.match(summarizeReconcile(r, "propose"), /^5 changes proposed/);
});

test("reconcileSystem: nothing to do reads as agreement; no ERD is said, not guessed", () => {
  const clean = reconcileSystem(SYSTEM, loadAll());
  assert.equal(clean.count, 0);
  assert.equal(clean.unresolved.length, 2, "the two Episode 140 findings stay open");
  const noErd = loadAll().filter((m) => m.kind !== "erd");
  const r = reconcileSystem(SYSTEM, noErd);
  assert.ok(r.unresolved.some((u) => /"WaveCount" is named as data .* the system has no ERD/.test(u)));
  assert.equal(summarizeReconcile(reconcileSystem(null, []), "auto"), "auto: the drawings already agree");
});

test("reconcileSystem: a participant object is declared when one machine and one held entity say which", () => {
  const seq: SequenceDefinition = {
    ...story([says("Open")]),
    participants: [{ name: "Person" }, { name: "Door", object: "door", holds: ["DoorRecord"] }],
  };
  const members: LoadedMember[] = [
    { path: "door.smdf.json", kind: "machine", def: DOOR },
    { path: "door.erdf.json", kind: "erd", def: { settings: { namespace: "d", name: "DoorData" }, entities: [], relationships: [] } },
    { path: "story.sqdf.json", kind: "sequence", def: seq },
  ];
  const r = reconcileSystem(null, members);
  assert.deepEqual(r.machines[0].ops[0], { op: "settings.update", patch: { objects: [{ instance: "door", class: "DoorRecord" }] } });
  assert.equal(r.erds[0].def.entities[0].name, "DoorRecord");
});

test("a member's notes are the system's to keep, and clear with an empty string", () => {
  const s = updateMember(SYSTEM, "wave_count_to_entry.sqdf.json", { notes: "the Episode 140 figure" });
  assert.equal(s.members[2].notes, "the Episode 140 figure");
  assert.equal(updateMember(s, "wave_count_to_entry.sqdf.json", { notes: "" }).members[2].notes, undefined);
  assert.throws(() => updateMember(SYSTEM, "nope.smdf.json", { notes: "x" }), /not a member/);
});

// ── Regressions from the 2026-09-30 adversarial review (R1–R16) ─────────────

const machine = (name: string, events: string[], state: StateMachineDefinition["state"]): StateMachineDefinition => ({
  settings: { namespace: "t", name, asynchronous: false },
  events: [{ name: "E", events: events.map((id) => ({ id })) }],
  state,
});
const tell = (...messages: SequenceDefinition["messages"]): SequenceDefinition => ({
  settings: { namespace: "t", name: "S" },
  participants: [{ name: "P" }, { name: "Q" }],
  messages,
});
const m = (event: string, extra: Partial<SequenceDefinition["messages"][number]> = {}) => ({ from: "P", to: "Q", label: event, event, ...extra });

test("R1: a transition into a state that cannot be entered is named, and reconcile does not repeat itself", () => {
  const M = machine("M", ["go"], { name: "Root", states: [{ name: "A", transitions: [{ event: "go", nextState: "Ghost" }] }, { name: "B" }] });
  const step = replayScenario(tell(m("go", { state: "B" })), [M]).paths[0].steps[0];
  assert.equal(step.result, "refused");
  assert.match(step.note!, /leads to Ghost, which cannot be entered/);
  const r = reconcileScenario(tell(m("go", { state: "B" })), [M]);
  assert.ok(r.proposals.reduce((n, p) => n + p.ops.length, 0) <= 1, JSON.stringify(r.proposals));
  assert.ok(r.unresolved.some((u) => /did not let the walk through|already proposed/.test(u)), r.unresolved.join("\n"));
});

test("R2: two machines with one name keep their own walks, and the system says so", () => {
  const X = machine("M", ["a"], { name: "Root", states: [{ name: "X1", transitions: [{ event: "a", nextState: "X2" }] }, { name: "X2" }] });
  const Y = machine("M", ["a"], { name: "Root", states: [{ name: "Y1" }] });
  const steps = replayScenario(tell(m("a")), [X, Y]).paths[0].steps;
  assert.deepEqual(steps.map((s) => [s.machine, s.from[0], s.result]), [["M #1", "X1", "moved"], ["M #2", "Y1", "refused"]]);
  const named = replayScenario(tell(m("a", { machine: "M" })), [X, Y]).paths[0].steps[0];
  assert.match(named.note!, /two member machines are named "M"/);
  const r = reconcileScenario(tell(m("new", { machine: "M", state: "Z" })), [X, Y]);
  assert.deepEqual(r.proposals, []);
  assert.match(r.unresolved[0], /2 member machines are named "M"/);
  const ids = checkSystem(null, [
    { path: "x.smdf.json", kind: "machine", def: X },
    { path: "y.smdf.json", kind: "machine", def: Y },
  ]).issues.map((i) => i.ruleId);
  assert.ok(ids.includes("Y005"));
});

test("R4: a broadcast event never creates one machine's state in another", () => {
  const Orders = machine("Orders", ["pay"], { name: "Root", states: [{ name: "Open", transitions: [{ event: "pay", nextState: "Paid" }] }, { name: "Paid" }] });
  const Audit = machine("Audit", ["pay"], { name: "Root", states: [{ name: "Idle" }] });
  const r = reconcileScenario(tell(m("pay", { state: "Paid" })), [Orders, Audit]);
  assert.equal(r.proposals.length, 0, JSON.stringify(r.proposals));
  assert.ok(r.unresolved.some((u) => /is a state of another machine; set the message's machine/.test(u)), r.unresolved.join("\n"));
});

test("R5: a final state in the possible set hears nothing, as at runtime", () => {
  const M = machine("M", ["go", "ev"], {
    name: "Root",
    states: [
      { name: "A", transitions: [{ event: "go", nextState: "Pdone", condition: "g" }, { event: "go", nextState: "B" }] },
      { name: "P", transitions: [{ event: "ev", nextState: "Z" }], states: [{ name: "Pinit" }, { name: "Pdone", kind: "final" }] },
      { name: "B" },
      { name: "Z" },
    ],
  });
  const steps = replayScenario(tell(m("go"), m("ev")), [M]).paths[0].steps;
  assert.deepEqual(steps[0].to.sort(), ["B", "Pdone"]);
  assert.equal(steps[1].result, "refused", "only B looks ev up, and B has no transition for it");
});

test("R6: an empty machine gains its first state, not a transition every state would inherit", () => {
  const Empty = machine("M", ["start"], { name: "Root", states: [] });
  const r = reconcileScenario(tell(m("start", { state: "Idle" }), m("go", { state: "Running" })), [Empty]);
  const ops = r.proposals[0].ops;
  assert.deepEqual(ops[0], { op: "state.add", parent: null, state: { name: "Idle", transitions: [] } });
  assert.equal(ops.some((o) => o.op === "transition.add" && o.state === "Root"), false, JSON.stringify(ops));
  assert.equal(r.after.paths[0].accepted, true, formatReplay(r.after));
});

test("R7: a fragment added without messages validates and renders", async () => {
  const { addFragment } = await import("../sequence/edit.js");
  const { validateSequence } = await import("../sequence/validate.js");
  const { renderMermaidSequence } = await import("../render/mermaidSequence.js");
  const s = addFragment(tell(m("a"), m("b")), { kind: "opt", label: "maybe", after: 1 });
  assert.deepEqual(s.fragments![0].messages, []);
  assert.deepEqual(validateSequence(s).map((e) => e.ruleId), ["S006"]);
  assert.match(renderMermaidSequence(s), /opt maybe/);
});

test("R8: every fragment at one branch point is drawn", async () => {
  const { renderMermaidSequence } = await import("../render/mermaidSequence.js");
  const s: SequenceDefinition = {
    ...tell(m("a"), m("b")),
    fragments: [
      { kind: "alt", label: "ALT-ONE", after: 1, messages: [m("x")] },
      { kind: "opt", label: "OPT-SAME-POINT", after: 1, messages: [m("y")] },
      { kind: "alt", label: "ALT-TWO", after: 1, messages: [m("z")] },
    ],
  };
  const text = renderMermaidSequence(s);
  for (const label of ["alt ALT-ONE", "opt OPT-SAME-POINT", "else ALT-TWO", "else as written"]) assert.ok(text.includes(label), `${label}\n${text}`);
  assert.equal((text.match(/^\s*end$/gm) ?? []).length, 2, text);
});

test("R11: a machine without events and a state inside a parallel region do not make reconcile throw", () => {
  const NoEvents = { settings: { namespace: "t", name: "N", asynchronous: false }, state: { name: "Root", states: [{ name: "S" }] } } as unknown as StateMachineDefinition;
  const r = reconcileScenario(tell(m("ping", { state: "S" })), [NoEvents]);
  assert.equal(r.proposals[0].ops[0].op, "eventSource.add");
  const Par = machine("Par", ["go", "tick"], {
    name: "Root",
    states: [
      { name: "Run", transitions: [{ event: "go", nextState: "R1" }], parallel: { nextState: "Done", states: [{ name: "R1" }] } },
      { name: "Done" },
    ],
  });
  assert.doesNotThrow(() => reconcileScenario(tell(m("go"), m("tick", { state: "Done" })), [Par]));
});

test("R15: a swap between two possible states is a move, and a machine that starts final has ended", () => {
  const M = machine("M", ["g", "swap"], {
    name: "Root",
    states: [
      { name: "S", transitions: [{ event: "g", nextState: "A", condition: "x" }, { event: "g", nextState: "B" }] },
      { name: "A", transitions: [{ event: "swap", nextState: "B" }] },
      { name: "B", transitions: [{ event: "swap", nextState: "A" }] },
    ],
  });
  assert.equal(replayScenario(tell(m("g"), m("swap")), [M]).paths[0].steps[1].result, "moved");
  const F = machine("F", ["go"], { name: "Root", transitions: [{ event: "go", nextState: "Other" }], states: [{ name: "End", kind: "final" }, { name: "Other" }] });
  assert.equal(replayScenario(tell(m("go")), [F]).paths[0].steps[0].result, "ended");
});

test("R16: a blank held entity is skipped, not thrown on", () => {
  const seq: SequenceDefinition = { ...tell(m("a")), participants: [{ name: "P", holds: [" "] }, { name: "Q" }] };
  assert.doesNotThrow(() => reconcileSystem(null, [{ path: "s.sqdf.json", kind: "sequence", def: seq }]));
});

test("L009: a state that is not final and has no way out is named; a prompt rides the live diff", async () => {
  const M = machine("M", ["go"], {
    name: "Root",
    states: [{ name: "A", transitions: [{ event: "go", nextState: "Waiting" }] }, { name: "Waiting" }, { name: "Done", kind: "final" }],
  });
  const warnings = checkSystem(null, [{ path: "m.smdf.json", kind: "machine", def: M }]).issues.filter((i) => i.ruleId === "L009");
  assert.deepEqual(warnings.map((w) => w.element), ["state:Waiting"]);
  const inherits = machine("M", ["go"], { name: "Root", transitions: [{ event: "go", nextState: "A" }], states: [{ name: "A" }] });
  assert.equal(checkSystem(null, [{ path: "m.smdf.json", kind: "machine", def: inherits }]).issues.filter((i) => i.ruleId === "L009").length, 0, "a transition on an ancestor is a way out");
  assert.equal(checkSystem(SYSTEM, loadAll()).issues.filter((i) => i.ruleId === "L009").length, 0, "the worked example has none");

  const { diffDefinition } = await import("../diff.js");
  const withPrompt = structuredClone(M);
  withPrompt.state.states![1].prompt = "Hold the rendezvous; reopen the discussion when price reaches it.";
  const ops = diffDefinition(M, withPrompt);
  assert.deepEqual(ops, [{ op: "state.update", name: "Waiting", patch: { prompt: "Hold the rendezvous; reopen the discussion when price reaches it." } }]);
  assert.equal(applyPatchOps(M, ops).state.states![1].prompt, withPrompt.state.states![1].prompt);
  const cleared = applyPatchOps(withPrompt, [{ op: "state.update", name: "Waiting", patch: { prompt: "" } }]);
  assert.equal("prompt" in cleared.state.states![1], false);
});
