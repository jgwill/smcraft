// node --test examples/decision-gate/lane-check/
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectEvidence, readTranscript, resolveLane, RUNNING } from "./lib/evidence.mjs";
import { buildQuestions, wireQuestions } from "./lib/questions.mjs";
import { buildRequest, decideDry, decideJev, readAnswer, typesafeKey } from "./lib/decider.mjs";
import { loadGate, runGate } from "./lib/gate.mjs";
import { calibrate, decisionsFor, loadPolicy, makeRuling, pending, summarize } from "./lane-check.mjs";

const gate = await loadGate();
const lane = { sessionId: "c9ee574b-0165-44e9-8974-4e83a977ae55", tmux: "trading-lane", episode: null };
const own = { word_owner: "lane" };
const unset = { act_at: null, block_at: null };
const set = { act_at: 0.8, block_at: 0.2 };

test("with no thresholds set, every answer lands in the ask band", () => {
  const r = runGate(gate, { decision: { p: 0.99, ruling_id: null }, relation: own, policy: unset });
  assert.equal(r.state, "AwaitingOwner");
  assert.equal(r.band, "ask");
});

test("the act and block bands follow the thresholds", () => {
  assert.equal(runGate(gate, { decision: { p: 0.9, ruling_id: null }, relation: own, policy: set }).band, "act");
  assert.equal(runGate(gate, { decision: { p: 0.1, ruling_id: null }, relation: own, policy: set }).band, "block");
  assert.equal(runGate(gate, { decision: { p: 0.5, ruling_id: null }, relation: own, policy: set }).band, "ask");
});

test("an unread answer never acts", () => {
  const r = runGate(gate, { decision: { p: null, ruling_id: null }, relation: own, policy: set });
  assert.equal(r.band, "ask");
});

test("a decision a person owns goes to them whatever the probability", () => {
  const r = runGate(gate, { decision: { p: 0.99, ruling_id: null }, relation: { word_owner: "William" }, policy: set });
  assert.equal(r.state, "AwaitingOwner");
  assert.equal(r.band, "owner");
});

test("the owner's ruling moves the machine: act to Acting, anything else to Blocked", () => {
  const owned = { decision: { p: 0.5, ruling_id: null }, relation: { word_owner: "William" }, policy: set };
  assert.equal(runGate(gate, { ...owned, ruling: { verdict: "act" } }).state, "Acting");
  assert.equal(runGate(gate, { ...owned, ruling: { verdict: "hold" } }).state, "Blocked");
});

test("a guard the table does not know fails closed", () => {
  const definition = structuredClone(gate.definition);
  const scoring = JSON.stringify(definition).replace("decision.p >= policy.act_at", "decision.p > 0");
  const r = runGate({ Machine: gate.Machine, definition: JSON.parse(scoring) }, { decision: { p: 0.99, ruling_id: null }, relation: own, policy: set });
  assert.notEqual(r.state, "Acting");
  assert.deepEqual(r.unknown_guards, ["decision.p > 0"]);
});

test("the request has TypeSafe's shape and none of our own fields", () => {
  const questions = buildQuestions({ question: "implement BOSf", asks: [] });
  const request = buildRequest({ question: "implement BOSf" }, wireQuestions(questions));
  assert.equal(request.model, "jev-1.13.0");
  assert.deepEqual(Object.keys(request.questions).sort(), ["asks_person", "claims_finished", "lane_status", "request_met"]);
  for (const q of Object.values(request.questions)) {
    assert.deepEqual(Object.keys(q).sort(), ["criteria", "instructions", "type"]);
    assert.ok(["noul", "choice"].includes(q.type));
  }
  assert.deepEqual(Object.keys(request.questions.lane_status.criteria), ["finished", "waiting", "working", "stopped_short"]);
});

test("one noul per ask when the lane has asks", () => {
  const questions = buildQuestions({ question: "x", asks: [{ id: "mino/ask-1", title: "a", words: ["w"] }, { id: "mino/ask-2", title: "b", words: ["v"] }] });
  assert.ok(questions.ask_1_met && questions.ask_2_met && !questions.request_met);
  assert.equal(questions.ask_2_met.ref, "mino/ask-2");
});

test("the dry decider sends nothing and reports the size", async () => {
  const response = await decideDry(buildRequest({ a: "b" }, {}));
  assert.equal(response.sent, false);
  assert.ok(response.within_budget);
});

test("the jev decider retries 429 and 529, and stops on anything else", async () => {
  const calls = [];
  const ok = { model: "jev-1.13.0", answers: { x: { type: "noul", noul: 0.9 } }, usage: {} };
  const replies = [{ status: 429 }, { status: 529 }, { status: 200, body: ok }];
  const fetchImpl = async (url, init) => {
    calls.push(init.headers.Authorization);
    const r = replies.shift();
    return { ok: r.status === 200, status: r.status, json: async () => r.body, text: async () => "", headers: { get: () => "0.001" } };
  };
  const response = await decideJev({ state: "s", model: "jev-1.13.0", questions: {} }, { apiKey: "k", fetchImpl });
  assert.equal(response.answers.x.noul, 0.9);
  assert.deepEqual(calls, ["Bearer k", "Bearer k", "Bearer k"]);
  const bad = async () => ({ ok: false, status: 422, text: async () => "bad question", headers: { get: () => null } });
  await assert.rejects(decideJev({}, { apiKey: "k", fetchImpl: bad }), /422/);
  await assert.rejects(decideJev({}, { apiKey: "" }), /TYPESAFE_API_KEY/);
});

test("answers are read into one number named for what it measures", () => {
  assert.equal(readAnswer({ type: "noul", noul: 0.95 }).p_measures, "probability that the statement is true");
  const c = readAnswer({ type: "choice", choice: "finished", probabilities: { finished: 0.88 }, confidence: 0.81 });
  assert.equal(c.value, "finished");
  assert.equal(c.p, 0.81);
  assert.equal(readAnswer(undefined).read_status, "unknown");
});

test("decision records carry the band, and the summary names a done claim without evidence", () => {
  const policy = loadPolicy();
  policy.set_by = "test";
  policy.classes.lane_status.act_at = 0.7;
  const questions = buildQuestions({ question: "q", asks: [] });
  const response = {
    model: "jev-1.13.0",
    sent: true,
    answers: {
      lane_status: { type: "choice", choice: "stopped_short", probabilities: { stopped_short: 0.85 }, confidence: 0.78 },
      claims_finished: { type: "noul", noul: 0.93 },
      asks_person: { type: "noul", noul: 0.1 },
      request_met: { type: "noul", noul: 0.3 },
    },
  };
  const evidence = { refs: { question: "file:/x#1", transcript: "/t.jsonl", commits: ["92089cc"] } };
  const records = decisionsFor({ lane, questions, response, policy, gate, evidence, now: "2026-10-05T20:00:00.000Z" });
  const status = records.find((r) => r.question.id === "lane_status");
  assert.equal(status.band, "act");
  assert.equal(status.state, "Acting");
  assert.equal(status.policy.set_by, "test");
  assert.ok(status.evidence.some((e) => e.kind === "commit" && e.ref === "92089cc"));
  const line = summarize(lane, records, response);
  assert.match(line, /stopped_short/);
  assert.match(line, /reopen/);
  assert.match(line, /claims finished \(0\.93\) without the evidence/);
  // asks_person belongs to William in the example policy.
  assert.equal(records.find((r) => r.question.id === "asks_person").band, "owner");
});

test("the person's queue holds unruled ask and owner decisions from a real decider", () => {
  const d = (id, band, decider = "jev-1.13.0") => ({ kind: "decision", id, band, decider, question: { id: "q" } });
  const records = [d("a", "ask"), d("b", "owner"), d("c", "act"), d("e", "ask", "dry"), d("f", "ask"), makeRuling({ decisionId: "f", by: "William", verdict: "act", words: "yes" })];
  assert.deepEqual(pending(records).map((r) => r.id), ["a", "b"]);
});

test("a ruling keeps the person's words and refuses what it cannot record", () => {
  const r = makeRuling({ decisionId: "dec-1", by: "William", verdict: "hold", words: "let's talk first", reading: "not now", source: "spoken_transcribed" });
  assert.equal(r.words, "let's talk first");
  assert.equal(r.reading, "not now");
  assert.throws(() => makeRuling({ decisionId: "d", by: "W", verdict: "maybe", words: "x" }), /verdict/);
  assert.throws(() => makeRuling({ decisionId: "d", verdict: "act", words: "x" }), /--by/);
});

test("calibrate suggests the lowest cut that agreed with the person often enough", () => {
  const records = [];
  for (let i = 0; i < 60; i += 1) {
    const p = i / 59;
    const id = `d${i}`;
    records.push({ kind: "decision", id, decider: "jev-1.13.0", p, question: { class: "lane_status" } });
    records.push(makeRuling({ decisionId: id, by: "William", verdict: p > 0.62 ? "act" : "hold", words: "w" }));
  }
  // At 0.60 one hold sits among 24 decisions (0.958 agree); at 0.65 all agree.
  assert.equal(calibrate(records, { target: 0.95, min: 10 }).lane_status.suggested_act_at, 0.6);
  const report = calibrate(records, { target: 0.99, min: 10 });
  assert.equal(report.lane_status.rulings, 60);
  assert.equal(report.lane_status.suggested_act_at, 0.65);
  assert.ok(report.lane_status.suggested_block_at <= 0.6);
});

test("the binding line names the lane, its latest session and whether it ended", () => {
  const lines = [
    { agent: "claude", event: "session.start", at: "2026-10-01T00:00:00Z", session_id: "old", tmux: { session: "ep140" } },
    { agent: "claude", event: "session.start", at: "2026-10-04T00:00:00Z", session_id: "new", cwd: "/b", transcript_path: "/t", tmux: { session: "ep140" } },
    { agent: "claude", event: "session.end", at: "2026-10-04T05:00:00Z", session_id: "new", tmux: { session: "ep140" } },
  ];
  const resolved = resolveLane("ep140", lines);
  assert.equal(resolved.sessionId, "new");
  assert.equal(resolved.startedAt, "2026-10-04T00:00:00Z");
  assert.equal(resolved.ended, true);
  assert.equal(resolveLane("nobody", lines), null);
});

test("the transcript gives files written, commits, pushes and an unanswered question", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane-check-"));
  const path = join(dir, "t.jsonl");
  const entries = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "/b/x.py" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "[main 92089cc] BOSf in production\n 1 file changed\nTo github.com:jgwill/x.git\n   eb4f804..92089cc  main -> main" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { questions: [{ question: "Strict or inclusive?" }] } }] } },
    { type: "assistant", timestamp: "t9", message: { content: [{ type: "text", text: "BOSf is in production." }] } },
  ];
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n"));
  const t = readTranscript(path);
  assert.deepEqual(t.files_touched, ["/b/x.py"]);
  assert.deepEqual(t.commits.map((c) => c.sha), ["92089cc"]);
  assert.deepEqual(t.pushes, [{ from: "eb4f804", to: "92089cc", ref: "main" }]);
  assert.deepEqual(t.unanswered_question.questions, ["Strict or inclusive?"]);
  assert.equal(t.last_messages.at(-1).text, "BOSf is in production.");
  writeFileSync(path, [...entries, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "q1", content: "Strict" }] } }].map((e) => JSON.stringify(e)).join("\n"));
  assert.equal(readTranscript(path).unanswered_question, null);
});

test("a running turn is recognised in both spinner forms, an idle prompt is not", () => {
  assert.ok(RUNNING.test("✶ Zigzagging… (6m 48s · thought for 11s)"));
  assert.ok(RUNNING.test("· Thinking… (12s · esc to interrupt)"));
  assert.ok(!RUNNING.test("❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)"));
});

test("the evidence is shrunk to fit the state budget, oldest messages first", async () => {
  const long = "x".repeat(5000);
  const dir = mkdtempSync(join(tmpdir(), "lane-check-"));
  const path = join(dir, "t.jsonl");
  writeFileSync(path, [1, 2, 3].map((i) => JSON.stringify({ type: "assistant", timestamp: `t${i}`, message: { content: [{ type: "text", text: `${i}${long}` }] } })).join("\n"));
  const witness = { threads: { lastWilliamInput: () => null }, links: { firstInput: () => ({ text: "q", ref: "file:/x#1" }) } };
  const { state } = await collectEvidence({ sessionId: "s", transcript: path, tmux: null }, { witness, paths: { sessiondata: dir }, maxChars: 7000 });
  assert.equal(state.last_messages.length, 1);
  assert.equal(state.last_messages[0].at, "t3");
  assert.ok(JSON.stringify(state).length <= 7000);
});

test("the key comes from the environment, then from one literal line of the env file", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane-check-"));
  const file = join(dir, ".env");
  writeFileSync(file, "OTHER=1\nexport TYPESAFE_API_KEY='ts-abc'\n$(touch /tmp/never)\n");
  assert.equal(typesafeKey({ TYPESAFE_ENV_FILE: file }), "ts-abc");
  assert.equal(typesafeKey({ TYPESAFE_API_KEY: "env-wins", TYPESAFE_ENV_FILE: file }), "env-wins");
  assert.equal(typesafeKey({ TYPESAFE_ENV_FILE: join(dir, "missing") }), null);
  writeFileSync(file, "JEV_AI_API_KEY=jev-1\nTYPESAFE_API_KEY=ts-2\n");
  assert.equal(typesafeKey({ TYPESAFE_ENV_FILE: file }), "jev-1");
  assert.equal(typesafeKey({ JEV_AI_API_KEY: "env-jev" }), "env-jev");
});
