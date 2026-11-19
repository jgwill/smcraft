/**
 * The decision tools (Spec 85), driven the way an agent drives them: a real
 * McpServer, a real Client, an in-memory transport, and a temp directory
 * holding a copy of Episode 564's advance gate (examples/advance-gate).
 *
 * The acceptance test of the format is here and in the protocol's own tests:
 * given a fixed snapshot and fixed answers, every caller gets the same outcome
 * and the same rule trace. The two callers are the protocol's evaluator and
 * these tools, and no engine is asked by either.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  evaluateDecisions,
  readLedger,
  renderMermaidDecisions,
  replayLedger,
  toEngineRequest,
  type DecisionModelDefinition,
} from "@miadi/stateloom-protocol";
import {
  decisionGetDefinition,
  decisionGetNotes,
  decisionLoadDefinition,
  decisionRender,
  decisionSetNotes,
  decisionSummary,
  registerDecisionTools,
  type DecisionHost,
} from "../decision.js";
import { resolveChronicleUri, resolveProjectSwitch } from "../projectSwitch.js";
import { sysRig, SYSTEM } from "./systemRig.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/advance-gate", import.meta.url));
const GATE = "advance-gate.dmdf.json";
const DRAFT = "advance-gate.draft-0.1.dmdf.json";
const LEDGER = "ledger-261114.jsonl";

interface Rig {
  dir: string;
  host: DecisionHost;
  emitted: DecisionModelDefinition[];
  setActive(name: string): void;
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; blocks: string[]; isError: boolean }>;
  read(name?: string): DecisionModelDefinition;
  lines(): Record<string, any>[];
  close(): Promise<void>;
}

async function rig(opts: { root?: boolean } = {}): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "loom-dmd-"));
  cpSync(EXAMPLE, dir, { recursive: true });
  let active = join(dir, GATE);
  const emitted: DecisionModelDefinition[] = [];
  const host: DecisionHost = {
    projectFile: () => active,
    emitFull: (def) => void emitted.push(def),
    outsideRoot: (p) => (opts.root && p !== dir && !resolve(p).startsWith(dir + "/") ? `Refused: ${p} is outside ${dir}` : undefined),
  };
  const server = new McpServer({ name: "dmd-test", version: "0.0.0" });
  registerDecisionTools(server, host);
  const client = new Client({ name: "dmd-test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    dir,
    host,
    emitted,
    setActive: (name) => {
      active = resolve(dir, name);
    },
    call: async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const blocks = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "");
      return { text: blocks.join("\n"), blocks, isError: r.isError === true };
    },
    read: (name = GATE) => JSON.parse(readFileSync(join(dir, name), "utf8")),
    lines: () =>
      readFileSync(join(dir, LEDGER), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    close: async () => {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("the advance gate validates through the loom, and its first drawing says what it lacks", async () => {
  const r = await rig();
  try {
    const valid = await r.call("validate_decision_model");
    assert.equal(valid.isError, false, valid.text);
    assert.match(valid.text, /^Decision model 'AdvanceGate' 0\.1\.0 is valid\.\n/);
    assert.match(valid.text, /request gate: advance, deletes, credential, names_new, money, foreign_repo, outside_audience/);
    assert.match(valid.text, /band — table, first, 4 rule\(s\); reads advance, deletes/);
    assert.match(valid.text, /ruling — person: the seat; the person when a held trigger is theirs/);
    assert.equal(decisionSummary(join(r.dir, GATE)), "existing decision model 'AdvanceGate' 0.1.0 (4 inputs, 7 questions, 1 table, 1 ruled by a person)");

    r.setActive(DRAFT);
    const draft = await r.call("validate_decision_model");
    assert.equal(draft.isError, true);
    assert.match(draft.text, /^9 problem\(s\) in 'AdvanceGate', 2 warning\(s\):/);
    assert.match(draft.text, /\[D009\] "deletes" states no criterion/);
    assert.match(draft.text, /\[D020\] \(warning\) "band" rule\(s\) 1, 2, 3, 4 are written in words only/);

    r.setActive("machine.smdf.json");
    const wrong = await r.call("validate_decision_model");
    assert.equal(wrong.isError, true);
    assert.match(wrong.text, /is a state machine, not a decision model/);
  } finally {
    await r.close();
  }
});

test("decision_request returns what the model asks its engine, and sends nothing", async () => {
  const r = await rig();
  try {
    const values = { action: "an act", request: "the person's words", facts: "what is known", repository: "none" };
    const asked = await r.call("decision_request", { values, rotation: 2 });
    assert.equal(asked.isError, false, asked.text);
    assert.match(asked.blocks[0], /^Request of 'AdvanceGate' 0\.1\.0: 7 question\(s\), \d+ characters\. Nothing was sent\.$/);
    assert.deepEqual(JSON.parse(asked.blocks[1]), toEngineRequest(r.read(), values, { rotation: 2 }));
    assert.deepEqual(Object.keys(JSON.parse(asked.blocks[1]).questions.advance.criteria), ["look_first", "advance", "hold_for_person"]);

    const short = await r.call("decision_request", { values: { action: "an act" } });
    assert.equal(short.isError, true);
    assert.match(short.text, /needs a value for: request, facts, repository/);
  } finally {
    await r.close();
  }
});

test("every caller gets the same outcome and rule trace: the tool's run is the protocol's run, for each recorded run", async () => {
  const r = await rig();
  try {
    const def = r.read();
    const lines = r.lines();
    const recorded = readLedger(def, lines).runs;
    assert.equal(recorded.length, 7);
    const replay = replayLedger(def, lines);
    for (const [i, run] of recorded.entries()) {
      const simulated = await r.call("simulate_decision", { answers: run.answers, values: run.values });
      assert.equal(simulated.isError, false, simulated.text);
      const viaTool = JSON.parse(simulated.blocks[1]);
      const viaProtocol = evaluateDecisions(def, { answers: run.answers, values: run.values });
      assert.deepEqual(viaTool, viaProtocol, run.id ?? "");
      const band = viaProtocol.results.find((x) => x.decision === "band")!;
      // The outcome the line recorded on 2026-11-14, and the rule the replay holds for it.
      assert.equal(band.outcome, lines.filter((l) => l.kind === "decision")[i].band, run.id ?? "");
      assert.equal(band.rule, replay.runs[i].outcomes.band.rule);
      assert.deepEqual(band.trace, replay.runs[i].run!.results.find((x) => x.decision === "band")!.trace);
      // No ruling was given to this call: the person's decision awaits its owner.
      assert.equal(viaProtocol.results.find((x) => x.decision === "ruling")!.status, "awaiting_owner");
    }
    const first = await r.call("simulate_decision", { answers: recorded[0].answers });
    assert.match(first.blocks[0], /band: hold_for_person \(rule 1\)\n {2}rule 1 holds: any of the six triggers >= 0\.5 \[.*foreign_repo\.yes 0\.74.*owner_at 0\.5\]/);
    assert.match(first.blocks[0], /ruling: awaiting its owner \(the seat; the person when a held trigger is theirs\)/);
  } finally {
    await r.close();
  }
});

test("simulate_decision takes a ruling and other bars, and an unanswered question goes to the failure route", async () => {
  const r = await rig();
  try {
    const answers = readLedger(r.read(), r.lines()).runs[1].answers;
    const ruled = await r.call("simulate_decision", { answers, rulings: { ruling: { outcome: "look_first", by: "mia", words: "The suite runs first." } } });
    assert.match(ruled.blocks[0], /band: seat_reads \(rule 4\)/);
    assert.match(ruled.blocks[0], /ruling: look_first, ruled by mia: "The suite runs first\."/);

    // With the choice's bar at 0.1, the same answers take the engine's choice (rule 3).
    const tried = await r.call("simulate_decision", { answers, bars: { advance_at: 0.1 } });
    assert.match(tried.blocks[0], /bars: owner_at 0\.5, uncertain_from 0\.4, uncertain_to 0\.6, advance_at 0\.1/);
    assert.match(tried.blocks[0], /band: look_first \(rule 3\)/);
    assert.equal(r.read().bars!.find((b) => b.name === "advance_at")!.value, 0.6, "the document is untouched");

    const partial = await r.call("simulate_decision", { answers: { ...answers, money: null } });
    assert.match(partial.blocks[0], /money: not answered/);
    assert.match(partial.blocks[0], /band: hold_for_person, by its failure route \(no valid answer for money\)/);
  } finally {
    await r.close();
  }
});

test("replay_decision_ledger replays Episode 564's recorded runs to their recorded bands, with no engine", async () => {
  const r = await rig();
  try {
    const replayed = await r.call("replay_decision_ledger", { json: true });
    assert.equal(replayed.isError, false, replayed.text);
    const text = replayed.blocks[0].split("\n");
    assert.equal(text[0], `Ledger ${join(r.dir, LEDGER)}`);
    assert.equal(text[1], "AdvanceGate 0.1.0: 16 line(s), of which 7 run(s), 8 ruling(s), 1 withdrawal(s)");
    assert.equal(text[2], "7 of 7 run(s) replayed: 7 give what was recorded, 0 differ");
    assert.equal(text[4], "ag-20261114180612587: band hold_for_person by rule 1, recorded hold_for_person: same · ruled advance by mia (against band, against advance)");
    assert.equal(text[8], "ag-20261114183703040: band hold_for_person by rule 2, recorded hold_for_person: same · ruled look_first by mia (against band, as advance)");
    assert.equal(
      text[11],
      "rulings in force: 7 (1 withdrawn), of the 20 after which a person may set a bar: not reached · band: 1 the same, 6 different; advance: 6 the same, 1 different",
    );
    // The whole replay as JSON is the protocol's, run for run and rule for rule.
    assert.deepEqual(JSON.parse(replayed.blocks[1]), JSON.parse(JSON.stringify(replayLedger(r.read(), r.lines()))));

    // Trying a bar is a question: the outcomes differ, and that is not an error.
    const tried = await r.call("replay_decision_ledger", { bars: { owner_at: 0.8 } });
    assert.equal(tried.isError, false, tried.text);
    assert.match(tried.text, /7 of 7 run\(s\) replayed: 4 give what was recorded, 3 differ/);
    assert.match(tried.text, /ag-20261114180612587: band seat_reads by rule 4, recorded hold_for_person: DIFFERENT/);
  } finally {
    await r.close();
  }
});

test("a line the replay cannot read is said to, and a ledger is read only where documents may be", async () => {
  const r = await rig({ root: true });
  try {
    const lines = r.lines();
    delete lines[0].triggers.credential;
    writeFileSync(join(r.dir, "partial.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
    const partial = await r.call("replay_decision_ledger", { ledger: "partial.jsonl" });
    assert.equal(partial.isError, false, partial.text);
    assert.match(partial.text, /6 of 7 run\(s\) replayed: 6 give what was recorded, 0 differ, 1 cannot be replayed/);
    assert.match(partial.text, /ag-20261114180612587: cannot be replayed, the line lacks the answer of credential \(triggers\.credential\)/);
    assert.match(partial.text, /1 line\(s\) are not JSON and were not read: 17/);

    // A recorded band that the rules no longer give is an error.
    lines[2].band = "advance";
    writeFileSync(join(r.dir, "changed.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const changed = await r.call("replay_decision_ledger", { ledger: "changed.jsonl" });
    assert.equal(changed.isError, true);
    assert.match(changed.text, /ag-20261114180623843: band seat_reads by rule 4, recorded advance: DIFFERENT/);

    const outside = await r.call("replay_decision_ledger", { ledger: "~/.miadi/decisions/advance-gate.jsonl" });
    assert.equal(outside.isError, true);
    assert.match(outside.text, /^Refused: .*advance-gate\.jsonl is outside/);
    const absent = await r.call("replay_decision_ledger", { ledger: "nowhere.jsonl" });
    assert.match(absent.text, /^No ledger at .*nowhere\.jsonl\.$/);
  } finally {
    await r.close();
  }
});

test("the tools that answer by extension read, load, draw and annotate a decision model", async () => {
  const r = await rig();
  try {
    const got = decisionGetDefinition(r.host);
    assert.deepEqual(JSON.parse(got.content[0].text), r.read());

    const drawn = decisionRender(r.host, {});
    const out = join(r.dir, "advance-gate.dmd.mmd");
    assert.match(drawn.content[0].text, new RegExp(`^Rendered decision model 'AdvanceGate' → ${out.replace(/[.\\/]/g, "\\$&")} \\(\\d+ bytes\\)$`));
    assert.equal(readFileSync(out, "utf8"), renderMermaidDecisions(r.read()));
    assert.equal(decisionRender(r.host, { format: "png" }).isError, true);

    const noted = decisionSetNotes(r.host, "band", "Why is the uncertain band 0.4 to 0.6?");
    assert.equal(noted.isError, undefined, noted.content[0].text);
    assert.equal(r.read().decisions.find((d) => d.name === "band")!.notes, "Why is the uncertain band 0.4 to 0.6?");
    assert.equal(r.emitted.length, 1);
    assert.match(decisionGetNotes(r.host).content[0].text, /^2 note\(s\) in 'AdvanceGate'.*\n\n\[diagram\]\n[\s\S]*\n\n\[band\]\nWhy is the uncertain band 0\.4 to 0\.6\?$/);
    assert.equal(decisionSetNotes(r.host, "nowhere", "x").isError, true);
    decisionSetNotes(r.host, "band", "");
    assert.equal("notes" in r.read().decisions.find((d) => d.name === "band")!, false);

    // A new document is written by load_definition, and what it lacks is said at once.
    r.setActive("new.dmdf.json");
    assert.match(decisionSummary(join(r.dir, "new.dmdf.json")), /^no file yet/);
    const refused = decisionLoadDefinition(r.host, JSON.stringify({ settings: { name: "X" }, participants: [], messages: [] }));
    assert.equal(refused.isError, true);
    const loaded = decisionLoadDefinition(r.host, JSON.stringify(r.read(DRAFT)));
    assert.equal(loaded.isError, undefined, loaded.content[0].text);
    assert.match(loaded.content[0].text, /^Loaded decision model → .*new\.dmdf\.json: AdvanceGate \(no version\) \(4 inputs, 7 questions, 1 table, 1 ruled by a person\)\n\[D012\]/);
    assert.equal(existsSync(join(r.dir, "new.dmdf.json")), true);
  } finally {
    await r.close();
  }
});

test("set_project_file's resolver knows the decision model's extension", () => {
  const r = resolveProjectSwitch("/x/advance-gate.dmdf.json", "/prev/doc.smdf.json");
  assert.equal(r.path, "/x/advance-gate.dmdf.json");
  const root = mkdtempSync(join(tmpdir(), "loom-chronicle-"));
  try {
    cpSync(EXAMPLE, join(root, "2026-10-26-episode-564-jev-decides-with-the-factory", "diagrams"), { recursive: true });
    const env = { MIADI_CHRONICLE_ROOT: root };
    const want = join(root, "2026-10-26-episode-564-jev-decides-with-the-factory", "diagrams", "advance-gate.dmdf.json");
    assert.equal(resolveChronicleUri("miadi-chronicle://564/advance-gate.dmdf", env), want);
    assert.equal(resolveChronicleUri("miadi-chronicle://564/advance-gate.dmdf.json", env), want);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a system takes a decision model as a member: its rules and D008 are in check_system, its drawing in the system's", async () => {
  const r = await sysRig();
  try {
    const model: DecisionModelDefinition = {
      settings: { namespace: "ElliottWave", name: "PublishGate", version: "0.1.0" },
      inputs: [{ name: "count", entity: "WaveCount" }],
      knowledge: [{ name: "Analyst", kind: "authority" }],
      decisions: [
        {
          name: "complete",
          logic: { kind: "question", type: "noul", instructions: "Is `count` labelled through its last wave?", criteria: { true: "Every wave of the count has a label." } },
          requires: ["count"],
        },
        {
          name: "publish",
          logic: {
            kind: "table",
            hit: "first",
            rules: [
              { when: "surely complete", if: "complete.yes >= 0.8", then: "publish" },
              { when: "otherwise", if: "otherwise", then: "hold" },
            ],
            failure: { then: "hold" },
          },
          requires: ["complete"],
          outcomes: ["publish", "hold"],
          machine: "ElliottWaveCountLifecycle",
          events: { publish: "PublishCount", hold: "KeepCounting" },
        },
        { name: "sign_off", logic: { kind: "person", who: "the analyst" }, requires: ["publish"], authority: ["Analyst"], outcomes: ["approved", "refused"] },
      ],
    };
    writeFileSync(join(r.dir, "publish_gate.dmdf.json"), JSON.stringify(model, null, 2));
    r.setActive(SYSTEM);
    const added = await r.call("add_member", { path: "publish_gate.dmdf.json" });
    assert.equal(added.isError, false, added.text);
    assert.match(added.text, /Added member decision 'publish_gate\.dmdf\.json'/);

    const checked = await r.call("check_system");
    assert.match(checked.text, /across 4 member\(s\)/);
    assert.match(checked.text, /D008[\s\S]*"publish" fires "KeepCounting" \(outcome hold\), which "ElliottWaveCountLifecycle" does not define/);
    assert.doesNotMatch(checked.text, /PublishCount.*does not define/);
    assert.doesNotMatch(checked.text, /Input "count"/, "WaveCount is an entity of the member ERD");

    // With the event the machine has, the model crosses cleanly.
    model.decisions[1].events = { publish: "PublishCount", hold: "ResetReading" };
    writeFileSync(join(r.dir, "publish_gate.dmdf.json"), JSON.stringify(model, null, 2));
    assert.doesNotMatch((await r.call("check_system")).text, /D008/);
  } finally {
    await r.close();
  }
});
