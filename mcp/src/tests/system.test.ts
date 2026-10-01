/**
 * The system tools (Spec 82) on a copy of the worked example
 * (examples/wave-count): a system of one ERD, one machine and one scenario.
 * A real McpServer and Client over an in-memory transport; the host stands in
 * for server.ts, and its `live` records what would go to the hub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StateMachineDefinition, SystemDefinition } from "@miadi/stateloom-protocol";
import { reconcileModeLine, systemGetNotes, systemRender, systemRispec, systemSetNotes } from "../system.js";
import { EXAMPLE, MACHINE, NEW_MESSAGE, SEQUENCE, SYSTEM, sysRig } from "./systemRig.js";

const machineOf = (doc: Record<string, unknown>): StateMachineDefinition =>
  (doc.stateMachine ?? doc) as StateMachineDefinition;

const transitionsOf = (def: StateMachineDefinition, state: string) => {
  const walk = (s: StateMachineDefinition["state"]): StateMachineDefinition["state"] | undefined =>
    s.name === state ? s : (s.states ?? []).map(walk).find(Boolean);
  return walk(def.state)?.transitions ?? [];
};

test("check_system on the worked example: no error, the two known L008 warnings, a replay line per path, and the mode", async () => {
  const r = await sysRig({
    validate: (def) => (def.settings?.name === "ElliottWaveCountLifecycle" ? [{ ruleId: "V999", message: "stand-in machine rule" }] : []),
  });
  try {
    const out = await r.call("check_system", { system: join(r.dir, SYSTEM) });
    assert.equal(out.isError, true, "the machine's own V rule is an error");
    assert.match(out.text, /Checked system 'ElliottWaveCount' .*: 1 error\(s\), 2 warning\(s\) across 3 member\(s\)\. Reconcile: propose\./);
    assert.match(out.text, /Errors \(1\)\n  V999 ×1\n    elliott_wave_count\.smdf\.json: stand-in machine rule/);
    assert.match(out.text, /Warnings \(2\)\n  L008 ×2\n/);
    assert.match(out.text, /main without optional messages, message 9/);
    assert.match(out.text, /alt 1 · the market settles the count first, message f1\.1/);
    assert.match(out.text, /Replay\n  WaveCountToEntry · main: accepted — ends with ElliottWaveCountLifecycle in StrategicEntry/);
    assert.match(out.text, /WaveCountToEntry · main without optional messages: stops at message 9/);

    const again = await r.call("check_system");
    assert.match(again.text, /Checked system 'ElliottWaveCount'/, "with no argument, the system that lists the active sequence");
  } finally {
    await r.close();
  }
});

test("a new event and a new state: L005 in check_system, a dry run that writes nothing, then apply writes the machine and patches its room", async () => {
  const r = await sysRig();
  try {
    const added = await r.call("add_message", NEW_MESSAGE);
    assert.equal(added.isError, false, added.text);
    assert.match(added.text, /^Added message 14: Strategy → Analysis/);
    assert.match(
      added.text,
      /\n2 changes proposed \(ElliottWaveCountLifecycle \+2\); 2 left open \(see check_system\) — reconcile_scenario apply:true, or set_reconcile_mode auto$/,
      "propose mode: one line",
    );

    const checked = await r.call("check_system");
    assert.match(checked.text, /L005 ×1\n    wave_count_to_entry\.sqdf\.json: Message 14 fires "CountFulfilled", which no member machine defines/);
    assert.match(checked.text, /Message 14 says the machine is then in "Fulfilled", which no member machine has/);

    const before = readFileSync(join(r.dir, MACHINE), "utf8");
    const dry = await r.call("reconcile_scenario");
    assert.equal(dry.isError, false, dry.text);
    assert.match(dry.text, /2 change\(s\), 2 left open/);
    assert.match(dry.text, /\+ event CountFulfilled \(source 5\)/);
    assert.match(dry.text, /\+ state Fulfilled under the root/);
    assert.match(dry.text, /\+ transition StrategicEntry --\[CountFulfilled\]--> Fulfilled/);
    assert.match(dry.text, /Dry run: nothing was written/);
    assert.equal(readFileSync(join(r.dir, MACHINE), "utf8"), before, "a dry run writes nothing");
    assert.equal(r.pushes.patch.length, 0);

    const applied = await r.call("reconcile_scenario", { apply: true });
    assert.equal(applied.isError, false, applied.text);
    assert.match(applied.text, /ElliottWaveCountLifecycle \(elliott_wave_count\.smdf\.json\): wrote 3 op\(s\) — patch sent live/);
    const machine = machineOf(r.json(MACHINE));
    assert.deepEqual(transitionsOf(machine, "StrategicEntry").at(-1), { event: "CountFulfilled", nextState: "Fulfilled" });
    assert.ok(machine.events.find((s) => s.name === "StrategyEvents")!.events!.some((e) => e.id === "CountFulfilled"));
    assert.equal(r.pushes.patch.length, 1);
    assert.equal(r.pushes.patch[0].docId, join(r.dir, MACHINE), "the machine's own room");
    assert.deepEqual(r.pushes.patch[0].ops.map((o) => o.op), ["event.add", "state.add", "transition.add"]);

    const clean = await r.call("check_system");
    assert.doesNotMatch(clean.text, /L005/);
    // The new state the scenario added has no way out yet: L009 says so, for the next instance.
    assert.match(clean.text, /0 error\(s\), 3 warning\(s\)/);
    assert.match(clean.text, /L009 ×1\n.*Fulfilled has no way out and is not final/);
  } finally {
    await r.close();
  }
});

test("auto mode: an add_message with a new event and state updates the machine on disk, with no extra call", async () => {
  const r = await sysRig();
  try {
    const mode = await r.call("set_reconcile_mode", { mode: "auto" });
    assert.match(mode.text, /Reconcile mode of 'ElliottWaveCount' is now auto\./);
    assert.equal(r.json<SystemDefinition>(SYSTEM).settings.reconcile, "auto");
    assert.equal(reconcileModeLine(r.systemHost, join(r.dir, SEQUENCE)), `reconcile: auto — system ${join(r.dir, SYSTEM)}`);

    const added = await r.call("add_message", NEW_MESSAGE);
    assert.equal(added.isError, false, added.text);
    assert.match(added.text, /\nauto: ElliottWaveCountLifecycle \+2; 2 left open \(see check_system\)$/);
    assert.deepEqual(transitionsOf(machineOf(r.json(MACHINE)), "StrategicEntry").at(-1), {
      event: "CountFulfilled",
      nextState: "Fulfilled",
    });
    assert.equal(r.pushes.patch.length, 1, "patched to the machine's room");

    const next = await r.call("add_message", { from: "Guillaume", to: "Analysis", label: "reads the result" });
    assert.match(next.text, /\nreconcile auto: 2 left open \(see check_system\)$/, "nothing more to apply");
    assert.equal(r.pushes.patch.length, 1);
  } finally {
    await r.close();
  }
});

test("auto mode reaches the ERD and the system: a carried entity and a new actor are written", async () => {
  const r = await sysRig({ reconcile: "auto" });
  try {
    await r.call("add_participant", { name: "Auditor", actor: "Auditor" });
    const added = await r.call("add_message", { from: "Auditor", to: "Analysis", label: "files a review", carries: "AuditNote" });
    assert.match(added.text, /\nauto: .*ElliottWaveCountData \+1/);
    const erd = r.json<{ entities: { name: string }[] }>("elliott_wave_count.erdf.json");
    assert.ok(erd.entities.some((e) => e.name === "AuditNote"));
    const system = r.json<SystemDefinition>(SYSTEM);
    assert.ok(system.actors!.some((a) => a.name === "Auditor" && a.kind === "person"));
    assert.ok(r.pushes.full.some((f) => f.docId === join(r.dir, "elliott_wave_count.erdf.json")), "the ERD goes whole to its room");
    assert.equal(
      reconcileModeLine(r.systemHost, join(r.dir, SYSTEM)),
      "reconcile: auto (STATELOOM_RECONCILE, for this session)",
    );
  } finally {
    await r.close();
  }
});

test("replay_scenario walks every path; show sends a view for a listed member and refuses one that is not", async () => {
  const r = await sysRig();
  try {
    const replay = await r.call("replay_scenario");
    assert.equal(replay.isError, false, replay.text);
    assert.match(replay.text, /^Scenario WaveCountToEntry against ElliottWaveCountLifecycle: some paths stop/);
    assert.match(replay.text, /\nmain — accepted\n/);

    const shown = await r.call("show", { member: MACHINE, focus: "state:Published_Tradable", note: "message 6 lands here" });
    assert.equal(shown.isError, false, shown.text);
    assert.deepEqual(r.pushes.view, [
      { docId: join(r.dir, SYSTEM), member: MACHINE, focus: "state:Published_Tradable", note: "message 6 lands here" },
    ]);
    const absolute = await r.call("show", { member: join(r.dir, SEQUENCE), focus: "message:9" });
    assert.equal(absolute.isError, false, absolute.text);
    assert.equal(r.pushes.view[1].member, SEQUENCE, "an absolute member is sent as the system writes it");

    const stranger = await r.call("show", { member: "other.smdf.json" });
    assert.equal(stranger.isError, true);
    assert.match(stranger.text, /is not a member of 'ElliottWaveCount'/);
    const badFocus = await r.call("show", { focus: "shape:x" });
    assert.equal(badFocus.isError, true);
    assert.match(badFocus.text, /focus is <kind>:<name>/);
    assert.equal(r.pushes.view.length, 2);
  } finally {
    await r.close();
  }
});

test("create_system stores members relative, add_member refuses a system, actors come and go, notes and render work", async () => {
  const r = await sysRig();
  try {
    const path = join(r.dir, "second.sysdf.json");
    const created = await r.call("create_system", {
      namespace: "demo",
      name: "Second",
      path,
      members: [join(r.dir, MACHINE), "later.sqdf.json"],
    });
    assert.equal(created.isError, false, created.text);
    assert.match(created.text, /No file yet at: later\.sqdf\.json/);
    assert.deepEqual(r.json<SystemDefinition>("second.sysdf.json").members, [{ path: MACHINE }, { path: "later.sqdf.json" }]);

    // The active sequence is listed by the example system, which the tools prefer; name the new one.
    const refused = await r.call("add_member", { path: SYSTEM, system: path });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /not a loom document a system can hold/);
    const outside = await r.call("add_member", { path: "/elsewhere/data.erdf.json", system: path });
    assert.match(outside.text, /Added member erd '\/elsewhere\/data\.erdf\.json' \(no file there yet\)/);
    const removed = await r.call("remove_member", { path: join(r.dir, "later.sqdf.json"), system: path });
    assert.match(removed.text, /Removed member 'later\.sqdf\.json'/);

    assert.equal((await r.call("add_actor", { name: "Mia", kind: "agent", system: path })).isError, false);
    assert.equal((await r.call("add_actor", { name: "Mia", kind: "agent", system: path })).isError, true);
    assert.equal((await r.call("remove_actor", { name: "Mia", system: path })).isError, false);

    r.setActive(SYSTEM);
    assert.equal(systemSetNotes(r.systemHost, MACHINE, "the lifecycle").isError, undefined);
    assert.match(systemGetNotes(r.systemHost).content[0].text, /\[elliott_wave_count\.smdf\.json\]\nthe lifecycle/);
    assert.equal(systemSetNotes(r.systemHost, "nope.smdf.json", "x").isError, true);
    assert.equal(systemSetNotes(r.systemHost, join(r.dir, MACHINE), "").isError, undefined, "an absolute path names the member too");
    assert.deepEqual(r.json<SystemDefinition>(SYSTEM).members[1], { path: MACHINE }, "an empty note removes the key");

    const drawn = systemRender(r.systemHost, {});
    assert.equal(drawn.isError, undefined, drawn.content[0].text);
    const md = readFileSync(join(r.dir, "elliott_wave_count.sys.md"), "utf8");
    assert.match(md, /## erd: elliott_wave_count\.erdf\.json — ElliottWaveCountData\n\n```mermaid\nerDiagram/);
    assert.match(md, /## machine: elliott_wave_count\.smdf\.json — ElliottWaveCountLifecycle\n\n```mermaid\nstateDiagram-v2/);
    assert.match(md, /## sequence: wave_count_to_entry\.sqdf\.json — WaveCountToEntry\n\n```mermaid\nsequenceDiagram/);
  } finally {
    await r.close();
  }
});

test("generate_rispec for a system: intent, data, behaviour, each path as a Creative Advancement Scenario, open questions", async () => {
  const r = await sysRig();
  try {
    const md = systemRispec(r.systemHost, { system: join(r.dir, SYSTEM) }).content[0].text;
    assert.match(md, /^# ElliottWaveCount — RISE rispec \(system\)/);
    assert.match(md, /## Creative Intent\n\nA hand-labelled wave count/);
    assert.match(md, /## Data\n\n### ElliottWaveCountData \(`elliott_wave_count\.erdf\.json`\)/);
    assert.match(md, /- \*\*WaveCount\*\*/);
    assert.match(md, /\*\*Relationships\*\*/);
    assert.match(md, /## Behaviour\n\n### ElliottWaveCountLifecycle \(`elliott_wave_count\.smdf\.json`\)/);
    assert.match(md, /#### States/);
    assert.match(md, /\*\*Creative Advancement Scenario\*\*: WaveCountToEntry\n\n\*\*Desired Outcome\*\*: Guillaume labels a wave count/);
    assert.match(md, /\*\*Current Reality\*\*: ElliottWaveCountLifecycle in Reading_Unset/);
    assert.match(md, /- \*\*1\.\*\* Guillaume → Chart: labels 1 and 2 — fires `LabelWave`; ElliottWaveCountLifecycle: Reading_Unset → Reading_Identified \(moved\)/);
    assert.match(md, /\*\*Resolution\*\*: ElliottWaveCountLifecycle in StrategicEntry\n/);
    assert.match(md, /\*\*Creative Advancement Scenario\*\*: WaveCountToEntry · alt 1 · the market settles the count first\n\n\*\*Desired Outcome\*\*: when the market settles the count first:/);
    assert.match(md, /## Open questions\n\n\*\*Where a scenario and the machines disagree \(L008\)\*\*\n\n- wave_count_to_entry\.sqdf\.json: main without optional messages, message 9/);
    assert.match(md, /\*\*What reconcile leaves to a person\*\*\n\n- WaveCountToEntry: message 9 \(main without optional messages\)/);
  } finally {
    await r.close();
  }
});

test("a sequence no system lists is replayed against the machines beside it", async () => {
  const r = await sysRig();
  try {
    writeFileSync(join(r.dir, SYSTEM), JSON.stringify({ settings: { namespace: "x", name: "Empty" }, members: [] }));
    const replay = await r.call("replay_scenario", { sequence: join(r.dir, SEQUENCE) });
    assert.equal(replay.isError, false, replay.text);
    assert.match(replay.text, /against ElliottWaveCountLifecycle/);
    const check = await r.call("check_system");
    assert.match(check.text, /Checked sequence wave_count_to_entry\.sqdf\.json with the machines and ERDs beside it \(no system lists it\)/);
  } finally {
    await r.close();
  }
});

test("rename_participant and move_participant carry the reconcile line: auto mode reports in one line", async () => {
  const r = await sysRig({ reconcile: "auto" });
  try {
    const renamed = await r.call("rename_participant", { name: "Market", to: "Exchange" });
    assert.equal(renamed.isError, false, renamed.text);
    assert.match(renamed.text, /^Renamed participant 'Market' to 'Exchange' in 3 message\(s\)\.\nreconcile auto: 2 left open \(see check_system\)$/);
    const seq = r.json<{ messages: { from: string }[] }>(SEQUENCE);
    assert.equal(seq.messages[9].from, "Exchange");
    const moved = await r.call("move_participant", { name: "Exchange", to: 1 });
    assert.match(moved.text, /^Moved participant 'Exchange' to column 1 of 7\.\nreconcile auto: 2 left open/);
  } finally {
    await r.close();
  }
});

// ─── Review findings (2026-09-30) ────────────────────────────────────

const ERD = "elliott_wave_count.erdf.json";
const has = (path: string, text: string): boolean => readFileSync(path, "utf8").includes(text);

test("R3: an explicit sequence is reconciled with the system that lists it, never with an active system that does not", async () => {
  const r = await sysRig();
  try {
    const other = join(r.dir, "other");
    cpSync(EXAMPLE, other, { recursive: true });
    const seq = JSON.parse(readFileSync(join(other, SEQUENCE), "utf8"));
    seq.messages.push({ from: "Strategy", to: "Analysis", label: "fills", event: "OnlyInOther", state: "OtherState" });
    writeFileSync(join(other, SEQUENCE), JSON.stringify(seq, null, 2));
    r.setActive(SYSTEM);

    const applied = await r.call("reconcile_scenario", { sequence: join(other, SEQUENCE), apply: true });
    assert.equal(applied.isError, false, applied.text);
    assert.ok(applied.text.startsWith(`Reconcile system 'ElliottWaveCount' (${join(other, SYSTEM)})`), applied.text);
    assert.equal(has(join(r.dir, MACHINE), "OnlyInOther"), false, "the active system's machine is untouched");
    assert.equal(has(join(other, MACHINE), "OnlyInOther"), true, "the sequence's own system's machine learned it");
    const replay = await r.call("replay_scenario", { sequence: join(other, SEQUENCE) });
    assert.match(replay.text, /main — accepted/, "replayed against its own, now reconciled, machine");
  } finally {
    await r.close();
  }
});

test("R9: a member outside the document root is refused when added, and never read when a system lists it", async () => {
  const r = await sysRig({ root: true });
  const outside = mkdtempSync(join(tmpdir(), "loom-outside-"));
  try {
    writeFileSync(
      join(outside, "secret.smdf.json"),
      JSON.stringify({ settings: { namespace: "x", name: "SECRET_NAME" }, events: [], state: { name: "Root", states: [{ name: "SECRET_STATE" }] } }),
    );
    const added = await r.call("add_member", { path: join(outside, "secret.smdf.json") });
    assert.equal(added.isError, true);
    assert.match(added.text, /outside the permitted document root/);
    const created = await r.call("create_system", { namespace: "x", name: "Leaky", members: [join(outside, "secret.smdf.json")] });
    assert.equal(created.isError, true);
    assert.match(created.text, /outside the permitted document root/);

    // A system file edited by hand to list it, and a member that is not JSON.
    writeFileSync(join(r.dir, "notjson.smdf.json"), "password=hunter2-and-more-text");
    const sys = r.json<SystemDefinition>(SYSTEM);
    sys.members.push({ path: join(outside, "secret.smdf.json") }, { path: "notjson.smdf.json" });
    writeFileSync(join(r.dir, SYSTEM), JSON.stringify(sys, null, 2));
    const checked = await r.call("check_system");
    assert.match(checked.text, /Y003 ×2/);
    assert.match(checked.text, /secret\.smdf\.json" cannot be read: it is outside the permitted document root \(STATELOOM_MCP_ROOT\), so it was not read/);
    assert.match(checked.text, /"notjson\.smdf\.json" cannot be read: it is not valid JSON/);
    assert.doesNotMatch(checked.text, /SECRET|hunter2|password/);
    r.setActive(SYSTEM);
    const drawn = systemRender(r.systemHost, {});
    assert.doesNotMatch(drawn.content[1].text, /SECRET|hunter2/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    await r.close();
  }
});

test("R10: in auto mode a document that cannot be written is named, the others are written, and no temp file is left", async () => {
  const r = await sysRig({ reconcile: "auto" });
  try {
    chmodSync(join(r.dir, ERD), 0o444);
    const before = readFileSync(join(r.dir, ERD), "utf8");
    const added = await r.call("add_message", { ...NEW_MESSAGE, carries: "BrandNewEntity" });
    assert.equal(added.isError, false, added.text);
    assert.match(added.text, /\nauto, partly applied: wrote ElliottWaveCountLifecycle \+2; NOT written: ElliottWaveCountData \(EACCES/);
    assert.match(added.text, /reconcile_scenario apply:true retries what is missing$/);
    assert.doesNotMatch(added.text, /could not run/);
    assert.equal(has(join(r.dir, MACHINE), "CountFulfilled"), true, "the machine was written");
    assert.equal(r.pushes.patch.length, 1, "and patched");
    assert.equal(readFileSync(join(r.dir, ERD), "utf8"), before, "the read-only ERD is untouched");

    const retry = await r.call("reconcile_scenario", { apply: true });
    assert.equal(retry.isError, true, "an apply that could not write everything is an error");
    assert.match(retry.text, /ElliottWaveCountData \(elliott_wave_count\.erdf\.json\): NOT written — EACCES/);
    chmodSync(join(r.dir, ERD), 0o644);
    const done = await r.call("reconcile_scenario", { apply: true });
    assert.equal(done.isError, false, done.text);
    assert.equal(has(join(r.dir, ERD), "BrandNewEntity"), true);
    assert.deepEqual(readdirSync(r.dir).filter((f) => f.endsWith(".tmp")), [], "temp files are renamed or removed");
  } finally {
    chmodSync(join(r.dir, ERD), 0o644);
    await r.close();
  }
});

test("R12: a sequence in a subfolder finds its system above it; the system listing the active document wins over the last one", async () => {
  const r = await sysRig();
  try {
    mkdirSync(join(r.dir, "scenarios"));
    renameSync(join(r.dir, SEQUENCE), join(r.dir, "scenarios", SEQUENCE));
    const sys = r.json<SystemDefinition>(SYSTEM);
    sys.settings.reconcile = "auto";
    sys.members = sys.members.map((m) => (m.path === SEQUENCE ? { path: `scenarios/${SEQUENCE}` } : m));
    writeFileSync(join(r.dir, SYSTEM), JSON.stringify(sys, null, 2));
    r.setActive(`scenarios/${SEQUENCE}`);
    const added = await r.call("add_message", NEW_MESSAGE);
    assert.match(added.text, /\nauto: ElliottWaveCountLifecycle \+2/);
    assert.equal(has(join(r.dir, MACHINE), "CountFulfilled"), true);
  } finally {
    await r.close();
  }

  const s = await sysRig();
  try {
    const first = join(s.dir, "first");
    cpSync(EXAMPLE, first, { recursive: true });
    const other = await sysRig({ last: join(first, SYSTEM) });
    try {
      const mode = await other.call("set_reconcile_mode", { mode: "auto" });
      assert.match(mode.text, /is now auto/);
      assert.equal(other.json<SystemDefinition>(SYSTEM).settings.reconcile, "auto", "the system that lists the active sequence");
      assert.equal(JSON.parse(readFileSync(join(first, SYSTEM), "utf8")).settings.reconcile, undefined, "not the last one");
    } finally {
      await other.close();
    }
  } finally {
    await s.close();
  }
});

test("R13: STATELOOM_RECONCILE=auto writes nothing beside a sequence that no system lists; it says what would change", async () => {
  const r = await sysRig({ reconcile: "auto" });
  try {
    rmSync(join(r.dir, SYSTEM));
    const machine = readFileSync(join(r.dir, MACHINE), "utf8");
    const added = await r.call("add_message", { ...NEW_MESSAGE, carries: "Brand" });
    assert.match(
      added.text,
      /\n3 changes proposed \(ElliottWaveCountLifecycle \+2, ElliottWaveCountData \+1\); .* — no system lists this sequence, so auto mode does not apply; reconcile_scenario apply:true writes it$/,
    );
    assert.equal(readFileSync(join(r.dir, MACHINE), "utf8"), machine);
    assert.equal(has(join(r.dir, ERD), '"Brand"'), false);
    assert.equal(r.pushes.patch.length + r.pushes.full.length, 0);
    assert.match(
      reconcileModeLine(r.systemHost, join(r.dir, SEQUENCE))!,
      /^reconcile: propose \(auto applies only within a system, and no system lists this sequence\)$/,
    );
  } finally {
    await r.close();
  }
});
