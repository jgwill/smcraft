#!/usr/bin/env node
// lane-check — ask, for each agent lane, whether it is finished, waiting, working or stopped
// short, and run every answer through the DecisionGate machine. Read only on the lanes.
//
//   node lane-check.mjs check <tmux-session|session-id>... [--live] [--decider dry|jev]
//        [--policy file] [--out decisions.jsonl] [--request-dir dir] [--json]
//   node lane-check.mjs models                      # the key's service and models; no inference
//   node lane-check.mjs probe                       # one small paid decision on a fixed sentence
//   node lane-check.mjs pending
//   node lane-check.mjs rule <decision-id> --by <person> --verdict <v> --words "<verbatim>"
//        [--reading "..."] [--source typed|question_box|spoken_transcribed|circle_turn]
//   node lane-check.mjs calibrate [--target 0.95] [--min 20]
//
// The default decider is dry: it sends nothing and shows the request that would leave the
// host. `pending` lists what waits for a person; `rule` records their answer; `calibrate`
// shows where thresholds would have agreed with those answers. Nothing writes the policy.
// All four use the ledger at $LANE_CHECK_LEDGER (default ~/.miadi/decisions/lane-check.jsonl)
// unless --out names another file.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectEvidence, liveLanes, loadWitness, resolveLane } from "./lib/evidence.mjs";
import { buildQuestions, wireQuestions } from "./lib/questions.mjs";
import { buildRequest, decideDry, decideJev, DEFAULT_MODEL, estimateTokens, listModels, readAnswer, resolveProvider, STATE_TOKEN_BUDGET } from "./lib/decider.mjs";
import { COORDINATOR_MOVE, loadGate, runGate } from "./lib/gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERDICTS = ["act", "hold", "deepen", "return", "defer", "no"];
export const SOURCES = ["typed", "question_box", "spoken_transcribed", "circle_turn"];

// The ledger: one JSONL file of decisions and the rulings on them. Outside every repository,
// so a run leaves no working tree dirty. A jev run appends to it; a dry run does only with --out.
export function ledgerPath(env = process.env) {
  return env.LANE_CHECK_LEDGER || join(homedir(), ".miadi", "decisions", "lane-check.jsonl");
}

function append(path, records) {
  mkdirSync(dirname(path), { recursive: true });
  for (const record of records) appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args.flags[key] = true;
    else {
      args.flags[key] = next;
      i += 1;
    }
  }
  return args;
}

export function loadPolicy(path = join(HERE, "policy.example.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function relationOf(cls) {
  return {
    word_owner: cls.word_owner ?? "lane",
    accountable_to: cls.accountable_to ?? [],
    reversible: cls.reversible ?? true,
    outward_facing: cls.outward_facing ?? false,
    does_not_authorize: cls.does_not_authorize ?? null,
  };
}

// The decision records for one lane, one per question, each run through the machine.
export function decisionsFor({ lane, questions, response, policy, gate, evidence, now = new Date().toISOString() }) {
  const records = [];
  for (const [qid, question] of Object.entries(questions)) {
    const cls = policy.classes?.[question.class] ?? {};
    const read = readAnswer(response.answers?.[qid]);
    const decision = { p: read.p, ruling_id: null };
    const relation = relationOf(cls);
    const thresholds = { act_at: cls.act_at ?? null, block_at: cls.block_at ?? null };
    const run = runGate(gate, { decision, relation, policy: thresholds });
    records.push({
      kind: "decision",
      id: `dec-${lane.sessionId.slice(0, 8)}-${qid}-${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
      at: now,
      question: {
        id: qid,
        class: question.class,
        kind: question.type,
        text: typeof question.instructions === "string" ? question.instructions : question.instructions.question,
        options: question.criteria,
        subject_ref: `session:${lane.sessionId}`,
        criteria_ref: question.ref ?? null,
      },
      relation,
      policy: { class: question.class, ...thresholds, set_by: policy.set_by ?? null },
      value: read.value,
      p: read.p,
      p_measures: read.p_measures,
      probabilities: read.probabilities ?? null,
      read_status: read.read_status,
      band: run.band,
      state: run.state,
      unknown_guards: run.unknown_guards,
      decider: response.model,
      destination: response.destination ?? null,
      run_id: response.billing?.run_id ?? response.id ?? null,
      session_id: lane.sessionId,
      tmux: lane.tmux,
      episode: lane.episode,
      evidence: [
        ...(evidence.refs.question ? [{ kind: "transcript_line", ref: evidence.refs.question }] : []),
        ...(evidence.refs.transcript ? [{ kind: "transcript_line", ref: evidence.refs.transcript }] : []),
        ...evidence.refs.commits.map((sha) => ({ kind: "commit", ref: sha })),
      ],
      ruling_id: null,
    });
  }
  return records;
}

// One line a coordinator reads per lane.
export function summarize(lane, records, response) {
  const by = Object.fromEntries(records.map((r) => [r.question.id, r]));
  const status = by.lane_status;
  const asks = records.filter((r) => r.question.class === "ask_met");
  const met = asks.filter((r) => r.value === true).length;
  const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : "?");
  const parts = [`${lane.tmux ?? lane.sessionId}`];
  if (!response.sent) parts.push(`dry: ${response.estimated_input_tokens} tokens${response.within_budget ? "" : " OVER the 32k state budget"}, nothing sent`);
  else {
    parts.push(`status ${status?.value ?? "?"} (confidence ${fmt(status?.p)}) → ${status?.band}${status?.band === "act" ? `: ${COORDINATOR_MOVE[status.value] ?? ""}` : ""}`);
    if (asks.length) parts.push(`asks met ${met}/${asks.length}`);
    if (by.claims_finished?.value === true && status?.value !== "finished") parts.push(`claims finished (${fmt(by.claims_finished.p)}) without the evidence`);
    if (by.asks_person?.value === true) parts.push(`a question waits for William (${fmt(by.asks_person.p)}) → ${by.asks_person.band}`);
  }
  return parts.join(" · ");
}

async function check(args) {
  const witness = await loadWitness();
  const paths = witness.threads.defaultPaths();
  const { lines } = witness.threads.readBindings(paths.bindings);
  const sessions = witness.threads.readSessionFiles(paths.sessionsDir);
  const targets = args.flags.live ? liveLanes(lines, sessions) : args._;
  if (!targets.length) throw new Error("name at least one lane (tmux session or session id), or pass --live");
  const decider = args.flags.decider ?? "dry";
  if (!["dry", "jev"].includes(decider)) throw new Error(`--decider is dry or jev, not ${decider}`);
  const policy = loadPolicy(args.flags.policy);
  const gate = await loadGate();
  const ledgers = witness.asks.readAllLedgers();
  const out = [];
  for (const target of targets) {
    const lane = resolveLane(target, lines);
    if (!lane) {
      out.push({ target, error: "no binding line names this lane" });
      continue;
    }
    const evidence = await collectEvidence(lane, { witness, paths, ledgers, maxChars: Number(args.flags["max-chars"] ?? 80_000) });
    const questions = buildQuestions(evidence.state);
    const request = buildRequest(evidence.state, wireQuestions(questions), args.flags.model ?? DEFAULT_MODEL);
    if (args.flags["request-dir"]) {
      mkdirSync(args.flags["request-dir"], { recursive: true });
      writeFileSync(join(args.flags["request-dir"], `${(lane.tmux ?? lane.sessionId).replace(/[^\w.-]/g, "_")}.request.json`), `${JSON.stringify(request, null, 2)}\n`);
    }
    const response = decider === "jev" ? await decideJev(request) : await decideDry(request);
    const records = decisionsFor({ lane, questions, response, policy, gate, evidence });
    const ledger = args.flags.out ?? (response.sent ? ledgerPath() : null);
    if (ledger) append(ledger, records);
    out.push({ lane, read: evidence.read, tokens: estimateTokens(request), budget: STATE_TOKEN_BUDGET, summary: summarize(lane, records, response), records });
  }
  if (args.flags.json) console.log(JSON.stringify(out, null, 2));
  else for (const item of out) console.log(item.error ? `${item.target} · ${item.error}` : item.summary);
  return out;
}

function readRecords(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// A person's answer to one decision. Their words are kept verbatim beside any reading of them.
export function makeRuling({ decisionId, by, verdict, words, reading = null, source = "typed", now = new Date().toISOString() }) {
  if (!decisionId) throw new Error("rule needs the decision id");
  if (!by) throw new Error("--by names the person who decided");
  if (!VERDICTS.includes(verdict)) throw new Error(`--verdict is one of ${VERDICTS.join(", ")}`);
  if (!words) throw new Error("--words carries what the person said, verbatim");
  if (!SOURCES.includes(source)) throw new Error(`--source is one of ${SOURCES.join(", ")}`);
  return { kind: "ruling", id: `rul-${decisionId}`, decision_id: decisionId, decided_by: by, words, reading, source, verdict, at: now };
}

function rule(args) {
  const path = args.flags.out ?? ledgerPath();
  const decisionId = args._[0];
  if (!readRecords(path).some((r) => r.kind === "decision" && r.id === decisionId)) throw new Error(`no decision ${decisionId} in ${path}`);
  const ruling = makeRuling({ decisionId, by: args.flags.by, verdict: args.flags.verdict, words: args.flags.words, reading: args.flags.reading ?? null, source: args.flags.source ?? "typed" });
  append(path, [ruling]);
  console.log(`${ruling.id} · ${ruling.verdict} by ${ruling.decided_by}`);
}

// One small paid decision on a sentence that carries nothing private: shows the destination,
// the resolved model, the answer, the tokens it used and the balance left. Writes no ledger.
export const PROBE = {
  state: "The tests pass and the change is pushed, but the owner has not yet ruled on question Q4.",
  questions: {
    finished: { type: "noul", instructions: "Is the work finished, with nothing left for anyone to decide?" },
  },
};

async function probe(args) {
  const provider = resolveProvider();
  const request = buildRequest(PROBE.state, PROBE.questions, args.flags.model ?? DEFAULT_MODEL);
  const response = await decideJev(request, { provider, attempts: 1 });
  const answer = response.answers?.finished;
  console.log(`${response.service} · ${response.destination}`);
  console.log(`model ${response.model} · finished = ${answer?.noul} (probability of yes)`);
  console.log(`usage ${JSON.stringify(response.usage)} · billing ${JSON.stringify(response.billing)}`);
  return response;
}

// Decisions in the ask or owner band that nobody has ruled on yet: the person's queue.
export function pending(records) {
  const ruled = new Set(records.filter((r) => r.kind === "ruling").map((r) => r.decision_id));
  return records.filter((r) => r.kind === "decision" && r.decider !== "dry" && (r.band === "ask" || r.band === "owner") && !ruled.has(r.id));
}

// Where a cut would have agreed with the person's rulings. Answers from the dry decider and
// decisions nobody ruled on are left out. It reports; it never edits the policy.
export function calibrate(records, { target = 0.95, min = 20 } = {}) {
  const rulings = new Map(records.filter((r) => r.kind === "ruling").map((r) => [r.decision_id, r]));
  const byClass = new Map();
  for (const d of records) {
    if (d.kind !== "decision" || d.decider === "dry" || typeof d.p !== "number" || !rulings.has(d.id)) continue;
    const list = byClass.get(d.question.class) ?? [];
    list.push({ p: d.p, act: rulings.get(d.id).verdict === "act" });
    byClass.set(d.question.class, list);
  }
  const report = {};
  for (const [cls, points] of byClass) {
    const cuts = [];
    for (let t = 0.5; t <= 0.991; t += 0.05) {
      const above = points.filter((x) => x.p >= t);
      const below = points.filter((x) => x.p <= 1 - t);
      cuts.push({
        cut: Number(t.toFixed(2)),
        act_n: above.length,
        act_agrees: above.length ? above.filter((x) => x.act).length / above.length : null,
        block_n: below.length,
        block_agrees: below.length ? below.filter((x) => !x.act).length / below.length : null,
      });
    }
    const act = cuts.find((c) => c.act_n >= min && c.act_agrees >= target);
    const block = [...cuts].reverse().find((c) => c.block_n >= min && c.block_agrees >= target);
    report[cls] = { rulings: points.length, suggested_act_at: act?.cut ?? null, suggested_block_at: block ? Number((1 - block.cut).toFixed(2)) : null, cuts };
  }
  return report;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const known = ["check", "rule", "pending", "calibrate", "models", "probe"];
  const args = parseArgs(known.includes(command) ? rest : process.argv.slice(2));
  if (command === "rule") return rule(args);
  if (command === "models") {
    const found = await listModels();
    console.log(`${found.service} · ${found.destination} · key ${found.keyName} · no inference, no charge`);
    for (const m of found.models) console.log(`  ${m.name}  ${m.description ?? ""}`);
    return found;
  }
  if (command === "probe") return probe(args);
  if (command === "pending") {
    const queue = pending(readRecords(args.flags.out ?? ledgerPath()));
    if (!queue.length) console.log("nothing waits for a ruling");
    for (const d of queue) console.log(`${d.id} · ${d.tmux ?? d.session_id} · ${d.question.id} = ${JSON.stringify(d.value)} (${d.p_measures} ${typeof d.p === "number" ? d.p.toFixed(2) : "?"}) · ${d.band}`);
    return queue;
  }
  if (command === "calibrate") {
    const report = calibrate(readRecords(args.flags.out ?? ledgerPath()), { target: Number(args.flags.target ?? 0.95), min: Number(args.flags.min ?? 20) });
    if (!Object.keys(report).length) console.log("no ruled decisions yet: record rulings with `rule` after a jev run");
    else console.log(JSON.stringify(report, null, 2));
    return report;
  }
  return check(args);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`lane-check: ${error.message}`);
    process.exit(1);
  });
}
