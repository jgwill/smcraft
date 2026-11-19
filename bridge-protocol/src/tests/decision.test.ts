/**
 * DMDF (Spec 85): the document, the rule language, the rules D001–D022, the
 * typed answers, the evaluator, the engine request, the Mermaid render and
 * system membership — on a small model and on Episode 564's advance gate
 * (examples/advance-gate), whose recorded runs are replayed without any engine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DMD_LIMITS,
  emptyDecisionModel,
  isDecisionModelDefinition,
  isDmdfPath,
  outcomesOf,
  requestGroups,
  safeModel,
  type DecisionModelDefinition,
} from "../decision/definition.js";
import { normalizeNotes } from "../notes.js";
import { checkRule, evalRule, parseRule, ruleRefs, RuleStop, type RuleNode, type RuleScope } from "../decision/expression.js";
import { readAnswer } from "../decision/answers.js";
import { ruleEnvOf, validateDecisionModel } from "../decision/validate.js";
import { evaluateDecisions, formatDecisionRun } from "../decision/evaluate.js";
import { toEngineRequest } from "../decision/engine.js";
import { formatLedgerReplay, readLedger, replayLedger } from "../decision/ledger.js";
import { renderMermaidDecisions } from "../render/mermaidDecisions.js";
import { MEMBER_KINDS, docKindOfContent, docKindOfPath, isSystemDefinition } from "../system/definition.js";
import { addMember } from "../system/edit.js";
import { checkSystem, membersByKind, type LoadedMember } from "../system/check.js";
import { isErdDefinition } from "../erd/definition.js";
import { isSequenceDefinition } from "../sequence/definition.js";
import type { StateMachineDefinition } from "../definition.js";

const file = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../examples/advance-gate/${name}`, import.meta.url)), "utf8");
const gate = (): DecisionModelDefinition => JSON.parse(file("advance-gate.dmdf.json"));
const draft = (): DecisionModelDefinition => JSON.parse(file("advance-gate.draft-0.1.dmdf.json"));
const ledger = (): Record<string, any>[] =>
  file("ledger-261114.jsonl")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/** A refund desk: two judgments, one fact, a first-hit table, and a person who rules what the table holds. */
const refund = (): DecisionModelDefinition => ({
  settings: { namespace: "demo", name: "Refund", version: "1.0.0" },
  binding: { model: "engine-1" },
  inputs: [
    { name: "message", description: "What the customer wrote." },
    { name: "amount", type: "number" },
  ],
  knowledge: [
    { name: "Policy", kind: "source" },
    { name: "Manager", kind: "authority" },
  ],
  bars: [{ name: "sure_at", value: 0.8 }],
  decisions: [
    {
      name: "asks_refund",
      logic: { kind: "question", type: "noul", instructions: "Does `message` ask for a refund?", criteria: { true: "It asks for money back." } },
      requires: ["message"],
      knowledge: ["Policy"],
    },
    {
      name: "category",
      logic: {
        kind: "question",
        type: "choice",
        instructions: "What is `message` about?",
        options: { billing: "A charge or an invoice.", delivery: "A parcel.", other: "Neither." },
      },
      requires: ["message"],
    },
    {
      name: "handling",
      logic: {
        kind: "table",
        hit: "first",
        rules: [
          { when: "a refund is asked for, surely, and it is small", if: "asks_refund.yes >= sure_at and amount <= 25", then: "refund" },
          { when: "a refund is asked for, surely", if: "asks_refund.yes >= sure_at", then: "review" },
          { when: "otherwise", if: "otherwise", then: "respond" },
        ],
        failure: { then: "review" },
      },
      requires: ["asks_refund", "category", "amount"],
      authority: ["Manager"],
      outcomes: ["refund", "respond", "review"],
    },
    {
      name: "sign_off",
      logic: { kind: "person", who: "the desk manager" },
      requires: ["handling"],
      authority: ["Manager"],
      outcomes: ["approve", "refuse"],
    },
  ],
});

const ids = (def: DecisionModelDefinition): string[] => validateDecisionModel(def).map((e) => `${e.severity === "warning" ? "w" : "e"}:${e.ruleId}`);
const errors = (def: DecisionModelDefinition): string[] => validateDecisionModel(def).filter((e) => e.severity !== "warning").map((e) => e.ruleId);
const result = (run: ReturnType<typeof evaluateDecisions>, name: string) => run.results.find((r) => r.decision === name)!;

// ── The document ─────────────────────────────────────────────────────────────

test("a decision model is known by its extension and by its shape", () => {
  assert.equal(isDmdfPath("/x/advance-gate.dmdf.json"), true);
  assert.equal(isDmdfPath("/x/advance-gate.DMDF.JSON"), true);
  assert.equal(isDmdfPath("/x/advance-gate.smdf.json"), false);
  assert.equal(docKindOfPath("a/b.dmdf.json"), "decision");
  assert.equal(docKindOfPath("a/b.json"), "machine");

  const def = gate();
  assert.equal(isDecisionModelDefinition(def), true);
  assert.equal(docKindOfContent(def), "decision");
  for (const other of [isErdDefinition, isSequenceDefinition, isSystemDefinition]) assert.equal(other(def), false);
  assert.equal(isDecisionModelDefinition({ settings: {}, participants: [], messages: [] }), false);
  assert.equal(isDecisionModelDefinition({ settings: {}, members: [], decisions: [] }), false);
  assert.equal(isDecisionModelDefinition(emptyDecisionModel("demo", "New")), true);
  assert.deepEqual(errors(emptyDecisionModel("demo", "New")), []);
});

// ── The rule language ────────────────────────────────────────────────────────

const scope = (values: Record<string, unknown>, answered: string[] = []): RuleScope => ({
  read(name, path) {
    const v = [name, ...path].reduce<unknown>((at, key, i) => (i === 0 ? values[key] : (at as Record<string, unknown> | undefined)?.[key]), undefined);
    if (v === undefined) throw new RuleStop("missing", `no ${name}`, name);
    return v as number;
  },
  answered: (name) => answered.includes(name),
  collected: () => false,
});
const tree = (rule: string): RuleNode => {
  const parsed = parseRule(rule);
  if (!parsed.ok) throw new Error(`${rule}: ${parsed.error}`);
  return parsed.ast;
};
const holds = (rule: string, values: Record<string, unknown> = {}, answered: string[] = []): boolean =>
  evalRule(tree(rule), scope(values, answered));

test("the rule language compares, combines and takes a maximum, with the usual precedence", () => {
  assert.equal(holds("1 + 2 * 3 == 7"), true);
  assert.equal(holds("(1 + 2) * 3 == 9"), true);
  assert.equal(holds("-2 + 5 > 2 and not (1 > 2)"), true);
  assert.equal(holds("false or true and false"), false);
  assert.equal(holds("max(a, b, 0.1) >= 0.5", { a: 0.2, b: 0.74 }), true);
  assert.equal(holds("min(a, b) < 0.1", { a: 0.2, b: 0.74 }), false);
  assert.equal(holds('x.choice == "advance"', { x: { choice: "advance" } }), true);
  assert.equal(holds('x.probabilities["2"] > 0.5', { x: { probabilities: { "2": 0.6 } } }), true);
  assert.equal(holds("otherwise"), true);
});

test("an interval holds its closed end and not its open one", () => {
  assert.equal(holds("p in [0.4, 0.6)", { p: 0.4 }), true);
  assert.equal(holds("p in [0.4, 0.6)", { p: 0.6 }), false);
  assert.equal(holds("p in (0.4, 0.6]", { p: 0.4 }), false);
  assert.equal(holds("p in (0.4, 0.6]", { p: 0.6 }), true);
  assert.equal(holds("p in [lo, hi)", { p: 0.47, lo: 0.4, hi: 0.6 }), true);
});

test("and and or stop at the operand that settles them, so a missing answer is not read", () => {
  assert.equal(holds("answered(advance) and advance.confidence >= 0.6", {}), false);
  assert.equal(holds("a >= 0.5 or b >= 0.5", { a: 0.9 }), true);
  assert.throws(() => holds("a >= 0.5 or b >= 0.5", { a: 0.1 }), (e) => e instanceof RuleStop && e.kind === "missing" && e.subject === "b");
});

test("a rule that cannot be read says where, and the language has no way out of itself", () => {
  for (const [rule, part] of [
    ["", "empty"],
    ["a >", "expected a value"],
    ["a >= 0.5 extra", "should end"],
    ["a in 0.4, 0.6", "expected an interval"],
    ["a in [0.4, 0.6", "to close the interval"],
    ['a == "open', "never closed"],
    ["a = 1", "not part of the rule language"],
    ["a; b", "not part of the rule language"],
    ["process(1)", "not a function of the rule language"],
    ["eval('1')", "not a function of the rule language"],
    ["otherwise and a", "stands alone"],
    ["a.0", "should end"],
    ["1.2.3 > 0", "not a number"],
    ["x".repeat(2001), "longer than"],
    ["(".repeat(40) + "1" + ")".repeat(40) + " == 1", "nests deeper"],
  ] as const) {
    const parsed = parseRule(rule);
    assert.equal(parsed.ok, false, rule);
    assert.ok(!parsed.ok && parsed.error.includes(part), `${rule} → ${parsed.ok ? "" : parsed.error}`);
  }
  // A name is only ever looked up in what the document declares: nothing of the host is reachable.
  const env = ruleEnvOf(refund(), refund().decisions[2]);
  for (const rule of ["constructor == 1", "__proto__.x == 1", "asks_refund.constructor == 1", "globalThis == 1"]) {
    assert.ok(checkRule(tree(rule), env).length > 0, rule);
  }
  assert.throws(() => holds("1 / 0 > 1"), (e) => e instanceof RuleStop && e.kind === "error");
  assert.throws(() => holds('a > "x"', { a: 1 }), (e) => e instanceof RuleStop && e.kind === "error");
  assert.throws(() => holds("a + 1", { a: 1 }), (e) => e instanceof RuleStop && /yes-or-no/.test(e.message));
});

test("a rule reads a judgment through its type, never as one number", () => {
  const def = refund();
  const env = ruleEnvOf(def, def.decisions[2]);
  const problems = (rule: string): string[] => checkRule(tree(rule), env);
  assert.deepEqual(problems("asks_refund.yes >= sure_at and amount <= 25"), []);
  assert.deepEqual(problems('category.choice == "billing" and category.confidence >= 0.5'), []);
  assert.deepEqual(problems("category.probabilities.billing > 0.5 and category.margin > 0.2 and category.top > 0.5"), []);
  assert.match(problems("asks_refund >= 0.5")[0], /is a noul answer, not one number: read \.yes/);
  assert.match(problems("category >= 0.5")[0], /is a choice answer, not one number/);
  assert.match(problems("asks_refund.confidence >= 0.5")[0], /a noul answer has no `confidence`/);
  assert.match(problems("category.probabilities.refund > 0.5")[0], /has no option "refund"/);
  assert.match(problems("category.probabilities > 0.5")[0], /read one probability/);
  assert.match(problems('category.choice > 0.5')[0], /takes numbers/);
  assert.match(problems('category.choice == 1')[0], /compares a string with a number/);
  assert.match(problems("message == 1 and nowhere > 1").join("|"), /`nowhere`, which is not an input, a bar or a decision/);
  assert.match(problems("sign_off.outcome == \"approve\"")[0], /does not require/);
  assert.match(problems("answered(amount)")[0], /answered\(\) asks about a question/);
  assert.match(problems("amount + 1")[0], /yes-or-no test/);
  assert.deepEqual(
    ruleRefs(tree("answered(category) and max(asks_refund.yes, 0.1) >= sure_at")).map((r) => `${r.use}:${r.name}`),
    ["answered:category", "value:asks_refund", "value:sure_at"],
  );
});

// ── Typed answers ────────────────────────────────────────────────────────────

test("each question type has its own answer, read in the engine's shape", () => {
  const def = refund();
  const noul = def.decisions[0].logic as never;
  const choice = def.decisions[1].logic as never;
  const score = { kind: "question", type: "score", instructions: "How urgent?", levels: ["not", "somewhat", "very"] } as never;

  assert.deepEqual(readAnswer(noul, { type: "noul", noul: 0.5 }), { status: "answered", answer: { type: "noul", yes: 0.5 } });
  assert.deepEqual(readAnswer(noul, undefined), { status: "missing" });
  assert.deepEqual(readAnswer(noul, null), { status: "missing" });
  assert.equal(readAnswer(noul, { noul: 1.2 }).status, "invalid");
  assert.equal(readAnswer(noul, { type: "choice", choice: "billing" }).status, "invalid");

  const chosen = readAnswer(choice, { type: "choice", choice: "delivery", confidence: 0.55, probabilities: { other: 0.1, delivery: 0.7, billing: 0.2 } });
  assert.deepEqual(chosen, {
    status: "answered",
    answer: { type: "choice", choice: "delivery", confidence: 0.55, probabilities: { billing: 0.2, delivery: 0.7, other: 0.1 }, top: 0.7, margin: 0.5 },
  });
  const bad = readAnswer(choice, { choice: "refund", confidence: 2, probabilities: { billing: 0.5, delivery: 0.1, extra: 0.4 } });
  assert.equal(bad.status, "invalid");
  assert.equal(bad.status === "invalid" && bad.failures.length, 4);
  const drift = readAnswer(choice, { choice: "billing", confidence: 0.2, probabilities: { billing: 0.5, delivery: 0.3, other: 0.1 } });
  assert.ok(drift.status === "invalid" && /sum to 0\.9/.test(drift.failures[0]));

  const scored = readAnswer(score, { type: "score", score: 1.4, confidence: 0.3, probabilities: { "0": 0.1, "1": 0.5, "2": 0.4 } });
  assert.ok(scored.status === "answered" && scored.answer.type === "score" && scored.answer.score === 1.4);
  assert.equal(readAnswer(score, { score: 3, confidence: 0.3, probabilities: { "0": 0.1, "1": 0.5, "2": 0.4 } }).status, "invalid");
});

// ── Validation ───────────────────────────────────────────────────────────────

test("the advance gate written to 0.2 has nothing to report, and neither has the refund desk", () => {
  assert.deepEqual(validateDecisionModel(gate()), []);
  assert.deepEqual(validateDecisionModel(refund()), []);
});

test("the first drawing of the advance gate, as Episode 564 holds it, is read and says what 0.2 asks of it", () => {
  const def = draft();
  assert.equal(isDecisionModelDefinition(def), true);
  assert.deepEqual(ids(def), [
    "e:D012",
    "e:D009", "e:D009", "e:D009", "e:D009", "e:D009", "e:D009",
    "e:D006",
    "w:D020",
    "e:D015",
    "w:D017",
  ]);
  const d006 = validateDecisionModel(def).find((e) => e.ruleId === "D006")!;
  assert.match(d006.message, /rule 3 gives "the advance choice", which is not one of its outcomes/);
  // It is still drawn, and it is not run: its table is written in words.
  assert.match(renderMermaidDecisions(def), /band<br\/><i>table · first · 4 rules<\/i>/);
  assert.equal(result(evaluateDecisions(def, {}), "band").status, "not_evaluable");
});

test("D001 to D007: the draft's rules", () => {
  const change = (f: (d: DecisionModelDefinition) => void): string[] => {
    const def = refund();
    f(def);
    return errors(def);
  };
  assert.deepEqual(change((d) => void (d.settings.name = "")), ["D001"]);
  assert.deepEqual(change((d) => void d.inputs!.push({ name: "handling" })), ["D002"]);
  assert.deepEqual(change((d) => void d.knowledge!.push({ name: "Policy", kind: "model" })), ["D002"]);
  assert.deepEqual(change((d) => void d.decisions[0].requires!.push("nowhere")), ["D003"]);
  assert.deepEqual(change((d) => void (d.decisions[0].knowledge = ["Manager"])), ["D003"]);
  assert.deepEqual(change((d) => void (d.decisions[2].authority = ["Policy"])), ["D003"]);
  assert.deepEqual(change((d) => void d.decisions[0].requires!.push("sign_off")), ["D004"]);
  assert.deepEqual(change((d) => void ((d.decisions[1].logic as { options: object }).options = { only: "one" })), ["D005"]);
  assert.deepEqual(change((d) => void ((d.decisions[0].logic as { type: string }).type = "guess")), ["D005"]);
  assert.deepEqual(change((d) => void ((d.decisions[0].logic as { kind: string }).kind = "oracle")), ["D005"]);
  assert.deepEqual(change((d) => void ((d.decisions[2].logic as { rules: unknown[] }).rules = [])), ["D006"]);
  assert.deepEqual(change((d) => void ((d.decisions[2].logic as { rules: { then: string }[] }).rules[0].then = "escalate")), ["D006"]);
  assert.deepEqual(change((d) => void ((d.decisions[0].logic as { instructions: string }).instructions = "Does `message` ask, given `amount`?")), ["D007"]);
  assert.deepEqual(change((d) => void ((d.decisions[0].logic as { instructions: string }).instructions = "Does `mesage` ask?")), ["D007"]);
});

test("a rule takes its outcome from a decision only when every value of that decision is one of the table's", () => {
  const def = refund();
  const table = def.decisions[2];
  (table.logic as { rules: object[] }).rules[1] = { when: "the category decides", if: "answered(category)", from: "category" };
  assert.match(validateDecisionModel(def).find((e) => e.ruleId === "D006")!.message, /which can give billing, delivery, other/);
  table.outcomes = ["refund", "respond", "review", "billing", "delivery", "other"];
  assert.deepEqual(errors(def), []);
  (table.logic as { rules: object[] }).rules[1] = { when: "both", if: "otherwise", then: "review", from: "category" };
  assert.deepEqual(errors(def), ["D006"]);
  (table.logic as { rules: object[] }).rules[1] = { when: "a noul gives no outcome", if: "otherwise", from: "asks_refund" };
  assert.deepEqual(errors(def), ["D006"]);
});

test("D009: every question states its criterion, a noul included", () => {
  const def = refund();
  delete (def.decisions[0].logic as { criteria?: object }).criteria;
  assert.deepEqual(errors(def), ["D009"]);
  // The criterion may arrive with the run, as an input the question requires and names.
  def.inputs!.push({ name: "acceptance" });
  Object.assign(def.decisions[0].logic, { criteria_from: "acceptance" });
  assert.deepEqual(errors(def), ["D009"]);
  def.decisions[0].requires!.push("acceptance");
  assert.match(validateDecisionModel(def).find((e) => e.ruleId === "D009")!.message, /its instructions never name it/);
  (def.decisions[0].logic as { instructions: string }).instructions = "Does `message` ask for a refund, read against `acceptance`?";
  assert.deepEqual(errors(def), []);

  const bare = refund();
  (bare.decisions[1].logic as { options: Record<string, string> }).options.other = " ";
  assert.deepEqual(errors(bare), ["D009"]);
});

test("D010: a group is one request, and a question that needs another's answer is not in it", () => {
  const def = refund();
  def.groups = [{ name: "desk", questions: ["asks_refund", "category"] }];
  assert.deepEqual(errors(def), []);
  assert.deepEqual(requestGroups(def), [{ name: "desk", questions: ["asks_refund", "category"], declared: true }]);

  def.groups.push({ name: "again", questions: ["category"] });
  assert.deepEqual(errors(def), ["D010"]);
  def.groups = [{ name: "desk", questions: ["asks_refund", "handling"] }];
  assert.deepEqual(errors(def), ["D010"]);

  // A dependency edge: `category` reads the answer of `asks_refund`, so they are two requests.
  const chained = refund();
  chained.decisions[1].requires!.push("asks_refund");
  chained.groups = [{ name: "desk", questions: ["asks_refund", "category"] }];
  assert.match(validateDecisionModel(chained).find((e) => e.ruleId === "D010")!.message, /"category" needs the answer of "asks_refund"/);
  delete chained.groups;
  assert.deepEqual(requestGroups(chained), [
    { name: "default", questions: ["asks_refund"], declared: false },
    { name: "category", questions: ["category"], declared: false },
  ]);
});

test("D011 to D016: hit policy, version, events, the rule language, the failure route, the person", () => {
  const change = (f: (d: DecisionModelDefinition) => void): string[] => {
    const def = refund();
    f(def);
    return errors(def);
  };
  assert.deepEqual(change((d) => void delete (d.decisions[2].logic as { hit?: string }).hit), ["D011"]);
  assert.deepEqual(change((d) => void ((d.decisions[2].logic as { hit: string }).hit = "any")), ["D011"]);
  assert.deepEqual(change((d) => void delete d.settings.version), ["D012"]);

  assert.deepEqual(change((d) => void Object.assign(d.decisions[2], { machine: "Desk", event: "HandlingSelected" })), []);
  assert.deepEqual(change((d) => void Object.assign(d.decisions[2], { machine: "Desk", events: { refund: "Refund", review: "Review" } })), ["D013"]);
  assert.deepEqual(change((d) => void Object.assign(d.decisions[2], { events: { refund: "Refund", review: "Review", respond: "Respond", later: "Later" } })), ["D013"]);
  assert.deepEqual(change((d) => void Object.assign(d.decisions[2], { event: "Selected", events: { refund: "Refund" } })), []);

  const rule = (text: string) => (d: DecisionModelDefinition) => void ((d.decisions[2].logic as { rules: { if: string }[] }).rules[0].if = text);
  assert.deepEqual(change(rule("asks_refund.yes >=")), ["D014"]);
  assert.deepEqual(change(rule("asks_refund >= sure_at")), ["D014"]);
  assert.deepEqual(change(rule("message.length > 3")), ["D014"]);
  assert.deepEqual(change(rule("sign_off.outcome == \"approve\"")), ["D014"]);
  assert.deepEqual(change(rule("answered(sign_off)")), ["D014"]);

  assert.deepEqual(change((d) => void delete (d.decisions[2].logic as { failure?: object }).failure), ["D015"]);
  assert.deepEqual(change((d) => void ((d.decisions[2].logic as { failure: { then: string } }).failure.then = "shrug")), ["D015"]);

  assert.deepEqual(change((d) => void ((d.decisions[3].logic as { who: string }).who = "")), ["D016"]);
  assert.deepEqual(change((d) => void (d.decisions[3].outcomes = [])), ["D016"]);
  // No bar, no rule and no failure route stands in for a ruling.
  assert.deepEqual(change((d) => void Object.assign(d.decisions[3].logic, { failure: { then: "approve" } })), ["D016"]);
  assert.deepEqual(change((d) => void Object.assign(d.decisions[3].logic, { rules: [{ when: "sure", if: "asks_refund.yes > 0.99", then: "approve" }] })), ["D016"]);
});

test("D017 to D022: the binding, the bars, what the rules leave uncovered, the rulings", () => {
  const change = (f: (d: DecisionModelDefinition) => void): string[] => {
    const def = refund();
    f(def);
    return ids(def);
  };
  assert.deepEqual(change((d) => void (d.binding = { model: "engine-1", credentials: "ENGINE_API_KEY", timeout_ms: 30000 })), []);
  assert.deepEqual(change((d) => void (d.binding = { model: "engine-1", credentials: "sk-live-0123456789" })), ["e:D017"]);
  assert.deepEqual(change((d) => void (d.binding = { timeout_ms: 0 })), ["e:D017"]);
  assert.deepEqual(change((d) => void Object.assign(d.decisions[0].logic, { model: "engine-2" })), ["e:D017"]);
  assert.deepEqual(change((d) => void (d.settings.engine = "engine-0")), ["w:D017"]);

  assert.deepEqual(change((d) => void d.bars!.push({ name: "sure_at", value: 0.9 })), ["e:D018"]);
  assert.deepEqual(change((d) => void d.bars!.push({ name: "amount", value: 1 })), ["e:D018"]);
  assert.deepEqual(change((d) => void d.bars!.push({ name: "max", value: 1 })), ["e:D018"]);
  assert.deepEqual(change((d) => void (d.bars![0].value = "high" as never)), ["e:D018"]);
  assert.deepEqual(change((d) => void (d.bars![0].calibrated_from = -1)), ["e:D018"]);

  assert.deepEqual(change((d) => void (d.decisions[2].logic as { rules: object[] }).rules.pop()), ["w:D019"]);
  assert.deepEqual(change((d) => void (d.decisions[2].logic as { rules: object[] }).rules.reverse()), ["w:D019"]);
  assert.deepEqual(change((d) => void ((d.decisions[2].logic as { hit: string }).hit = "unique")), ["w:D019"]);
  assert.deepEqual(change((d) => void delete (d.decisions[2].logic as { rules: { if?: string }[] }).rules[1].if), ["w:D020"]);
  assert.deepEqual(change((d) => void (d.decisions[2].requires = ["asks_refund", "amount"])), ["w:D021"]);

  assert.deepEqual(change((d) => void (d.rulings = { key: "run", bar_after: 20, decision: "sign_off" })), []);
  assert.deepEqual(change((d) => void (d.rulings = { bar_after: 0 })), ["e:D022"]);
  assert.deepEqual(change((d) => void (d.rulings = { decision: "handling" })), ["e:D022"]);
  assert.deepEqual(change((d) => void (d.rulings = { record: { answers: { asks_refund: { noul: "p" }, category: { choice: "c" } } } })), ["e:D022"]);
  assert.deepEqual(change((d) => void (d.rulings = { record: { answers: { handling: { noul: "p" } }, outcomes: { nowhere: "x" }, values: { nowhere: "y" } } })), ["e:D022", "e:D022", "e:D022"]);
});

// ── The evaluator ────────────────────────────────────────────────────────────

const ANSWERS = {
  asks_refund: { type: "noul", noul: 0.91 },
  category: { type: "choice", choice: "billing", confidence: 0.7, probabilities: { billing: 0.8, delivery: 0.1, other: 0.1 } },
};

test("a run gives each table's outcome, the rule that decided it and what each rule read", () => {
  const run = evaluateDecisions(refund(), { values: { message: "I want my money back", amount: 40 }, answers: ANSWERS });
  assert.deepEqual(run.definition, { namespace: "demo", name: "Refund", version: "1.0.0" });
  assert.deepEqual(run.bars, { sure_at: 0.8 });
  assert.deepEqual(result(run, "handling"), {
    decision: "handling",
    kind: "table",
    status: "decided",
    outcome: "review",
    rule: 2,
    trace: [
      { rule: 1, when: "a refund is asked for, surely, and it is small", held: false, reads: { "asks_refund.yes": 0.91, sure_at: 0.8, amount: 40 } },
      { rule: 2, when: "a refund is asked for, surely", held: true, reads: { "asks_refund.yes": 0.91, sure_at: 0.8 } },
    ],
  });
  assert.equal(result(evaluateDecisions(refund(), { values: { amount: 12 }, answers: ANSWERS }), "handling").outcome, "refund");
  assert.equal(result(evaluateDecisions(refund(), { values: { amount: 12 }, answers: { ...ANSWERS, asks_refund: { noul: 0.2 } } }), "handling").rule, 3);
  assert.match(formatDecisionRun(run), /handling: review \(rule 2\)\n {2}rule 1 does not hold: .* \[asks_refund\.yes 0\.91, sure_at 0\.8, amount 40\]/);
});

test("the same document and the same answers give the same trace, whatever order they arrive in", () => {
  const a = evaluateDecisions(refund(), { values: { message: "m", amount: 40 }, answers: ANSWERS });
  const b = evaluateDecisions(refund(), {
    answers: { category: { probabilities: { other: 0.1, delivery: 0.1, billing: 0.8 }, confidence: 0.7, choice: "billing", type: "choice" }, asks_refund: { noul: 0.91 } },
    values: { amount: 40, message: "m" },
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("a bar is read by name, and another value can be tried on the same answers", () => {
  const input = { values: { amount: 12 }, answers: ANSWERS };
  assert.equal(result(evaluateDecisions(refund(), input), "handling").outcome, "refund");
  const tried = evaluateDecisions(refund(), { ...input, bars: { sure_at: 0.95, unknown_bar: 1 } });
  assert.deepEqual(tried.bars, { sure_at: 0.95 });
  assert.equal(result(tried, "handling").outcome, "respond");
});

test("an engine that fails or times out sends the table to its failure route, and is not a no", () => {
  const def = refund();
  const none = evaluateDecisions(def, { values: { amount: 12 } });
  assert.equal(result(none, "asks_refund").status, "missing");
  const failed = result(none, "handling");
  assert.equal(failed.status, "failed");
  assert.equal(failed.outcome, "review");
  assert.deepEqual(failed.missing, ["asks_refund"]);
  assert.equal(failed.rule, undefined);
  assert.equal(failed.trace![0].held, null);

  // An answer that breaks its contract is not read either.
  const broken = evaluateDecisions(def, { values: { amount: 12 }, answers: { ...ANSWERS, asks_refund: { noul: 7 } } });
  assert.equal(result(broken, "asks_refund").status, "invalid");
  assert.equal(result(broken, "handling").status, "failed");

  // Without a declared route there is no outcome: nothing is assumed.
  delete (def.decisions[2].logic as { failure?: object }).failure;
  const routeless = result(evaluateDecisions(def, { values: { amount: 12 } }), "handling");
  assert.equal(routeless.status, "failed");
  assert.equal(routeless.outcome, undefined);
});

test("a person's decision awaits its owner until a ruling is recorded, and nothing computed stands in for it", () => {
  const def = refund();
  const waiting = result(evaluateDecisions(def, { values: { amount: 12 }, answers: ANSWERS }), "sign_off");
  assert.deepEqual(waiting, { decision: "sign_off", kind: "person", status: "awaiting_owner", who: "the desk manager" });

  const words = "Refund it, she has been a customer for ten years.";
  const ruled = result(
    evaluateDecisions(def, { values: { amount: 12 }, answers: ANSWERS, rulings: { sign_off: { outcome: "approve", by: "Ada", words, at: "2026-11-18T10:00:00Z" } } }),
    "sign_off",
  );
  assert.deepEqual(ruled, { decision: "sign_off", kind: "person", status: "ruled", outcome: "approve", who: "the desk manager", by: "Ada", words, at: "2026-11-18T10:00:00Z" });

  // A ruling names who ruled, and rules one of the outcomes.
  assert.equal(result(evaluateDecisions(def, { rulings: { sign_off: { outcome: "approve", by: "" } } }), "sign_off").status, "error");
  assert.equal(result(evaluateDecisions(def, { rulings: { sign_off: { outcome: "maybe", by: "Ada" } } }), "sign_off").status, "error");

  // A table that reads the ruling waits with it. Its failure route is for an engine, not for a person.
  def.decisions.push({
    name: "payout",
    logic: {
      kind: "table",
      hit: "first",
      rules: [
        { when: "approved", if: 'sign_off.outcome == "approve"', then: "pay" },
        { when: "otherwise", if: "otherwise", then: "close" },
      ],
      failure: { then: "pay" },
    },
    requires: ["sign_off"],
    outcomes: ["pay", "close"],
  });
  assert.deepEqual(errors(def), []);
  const held = result(evaluateDecisions(def, { values: { amount: 12 }, answers: ANSWERS }), "payout");
  assert.equal(held.status, "awaiting_owner");
  assert.equal(held.outcome, undefined);
  assert.deepEqual(held.awaiting, ["sign_off"]);
  const paid = evaluateDecisions(def, { values: { amount: 12 }, answers: ANSWERS, rulings: { sign_off: { outcome: "approve", by: "Ada" } } });
  assert.equal(result(paid, "payout").outcome, "pay");
});

test("unique refuses two rules holding together, collect keeps every one, and an uncovered run has no outcome", () => {
  const table = (hit: string, rules: object[]): DecisionModelDefinition => ({
    settings: { namespace: "demo", name: "Flags", version: "1" },
    inputs: [{ name: "n", type: "number" }],
    decisions: [{ name: "flags", logic: { kind: "table", hit, rules } as never, requires: ["n"], outcomes: ["big", "even", "small"] }],
  });
  const rules = [
    { when: "big", if: "n >= 10", then: "big" },
    { when: "even", if: "n == 12 or n == 4", then: "even" },
    { when: "small", if: "n < 3", then: "small" },
  ];
  const at = (hit: string, n: number) => evaluateDecisions(table(hit, rules), { values: { n } }).results[0];
  assert.deepEqual([at("collect", 12).outcomes, at("collect", 12).rules], [["big", "even"], [1, 2]]);
  assert.deepEqual(at("collect", 5).outcomes, []);
  assert.equal(at("unique", 12).status, "conflict");
  assert.deepEqual(at("unique", 12).rules, [1, 2]);
  assert.equal(at("first", 12).outcome, "big");
  assert.equal(at("unique", 11).outcome, "big");

  const gaps = table("first", [rules[0], rules[2]]);
  assert.equal(evaluateDecisions(gaps, { values: { n: 5 } }).results[0].status, "no_rule");
  // A value the run does not give is said, not replaced.
  assert.match(evaluateDecisions(gaps, {}).results[0].message!, /the input `n` has no value in this run/);

  // A table downstream of a collect table asks what was collected.
  const def = table("collect", rules);
  def.decisions.push({
    name: "route",
    logic: {
      kind: "table",
      hit: "first",
      rules: [
        { when: "big was collected", if: 'collected(flags, "big")', then: "desk" },
        { when: "nothing was collected", if: "flags.count == 0", then: "queue" },
        { when: "otherwise", if: "otherwise", then: "queue" },
      ],
    } as never,
    requires: ["flags"],
    outcomes: ["desk", "queue"],
  });
  assert.deepEqual(errors(def), []);
  assert.equal(evaluateDecisions(def, { values: { n: 12 } }).results[1].outcome, "desk");
  assert.equal(evaluateDecisions(def, { values: { n: 5 } }).results[1].outcome, "queue");
});

// ── The engine request ───────────────────────────────────────────────────────

test("the request is built from the document: the state a group requires, and its questions with their criteria", () => {
  const request = toEngineRequest(refund(), { message: "I want my money back", amount: 40 });
  assert.deepEqual(request, {
    state: { message: "I want my money back" },
    model: "engine-1",
    questions: {
      asks_refund: { type: "noul", instructions: "Does `message` ask for a refund?", criteria: { true: "It asks for money back." } },
      category: {
        type: "choice",
        instructions: "What is `message` about?",
        criteria: { billing: "A charge or an invoice.", delivery: "A parcel.", other: "Neither." },
      },
    },
  });
  // The binding is apart: another provider's model changes nothing that is asked.
  const other = toEngineRequest(refund(), { message: "m" }, { model: "engine-9" });
  assert.equal(other.model, "engine-9");
  assert.deepEqual(other.questions, toEngineRequest(refund(), { message: "m" }).questions);
  assert.throws(() => toEngineRequest(refund(), {}), /needs a value for: message/);
  assert.throws(() => toEngineRequest(refund(), { message: "m" }, { group: "later" }), /No request 'later'/);
});

test("a question that needs another's answer is a later request, and that answer arrives as a value", () => {
  const def = refund();
  def.decisions[1].requires!.push("asks_refund");
  const second = toEngineRequest(def, { message: "m", asks_refund: 0.91 }, { group: "category" });
  assert.deepEqual(Object.keys(second.questions), ["category"]);
  assert.deepEqual(second.state, { message: "m", asks_refund: 0.91 });
  assert.throws(() => toEngineRequest(def, { message: "m" }, { group: "category" }), /needs a value for: asks_refund/);
});

test("the advance gate's request is what its script sent: seven questions, one state, the options in the recorded order", () => {
  const def = gate();
  const values = { action: "an act", request: "the person's words", facts: "what is known", repository: "none" };
  const runs = ledger().filter((l) => l.kind === "decision");
  runs.forEach((line, i) => {
    const request = toEngineRequest(def, values, { rotation: i });
    assert.deepEqual(Object.keys(request.state), ["action", "request", "facts", "repository"]);
    assert.equal(request.model, line.requested_model);
    assert.deepEqual(Object.keys(request.questions), ["advance", "deletes", "credential", "names_new", "money", "foreign_repo", "outside_audience"]);
    // The script rotated the options by the count of earlier runs and recorded the order.
    assert.deepEqual(Object.keys(request.questions.advance.criteria as object), line.option_order, line.id);
    assert.deepEqual(toEngineRequest(def, values, { optionOrder: { advance: line.option_order } }), request);
  });
  const first = toEngineRequest(def, values, { rotation: 0 });
  assert.deepEqual(first.questions.deletes, {
    type: "noul",
    instructions: "Does `action` delete a file, a branch, a record or a session that exists today?",
    criteria: { true: "It deletes something that exists.", false: "It deletes nothing." },
  });
  assert.equal("band" in first.questions || "ruling" in first.questions, false);
  assert.throws(() => toEngineRequest(def, values, { optionOrder: { advance: ["advance", "look_first"] } }), /is not its options/);
});

// ── The advance gate's ledger, replayed ──────────────────────────────────────

test("Episode 564's recorded runs replay through the band to their recorded outcomes, with no engine", () => {
  const def = gate();
  const lines = ledger();
  assert.equal(lines.length, 16);
  const replay = replayLedger(def, lines);

  // The ledger's 16 lines are 7 runs, 8 rulings and 1 withdrawal.
  assert.deepEqual(replay.counts, { runs: 7, rulings: 8, withdrawals: 1, other: 0 });
  assert.deepEqual([replay.replayed, replay.same, replay.different, replay.not_replayable, replay.version_differs], [7, 7, 0, 0, 0]);

  const recorded = lines.filter((l) => l.kind === "decision");
  assert.deepEqual(
    replay.runs.map((r) => [r.id, r.outcomes.band.replayed, r.outcomes.band.rule]),
    [
      ["ag-20261114180612587", "hold_for_person", 1],
      ["ag-20261114180623843", "seat_reads", 4],
      ["ag-20261114181630897", "hold_for_person", 1],
      ["ag-20261114182215678", "hold_for_person", 1],
      ["ag-20261114183703040", "hold_for_person", 2],
      ["ag-20261114185258305", "hold_for_person", 1],
      ["ag-20261114185304783", "hold_for_person", 1],
    ],
  );
  replay.runs.forEach((r, i) => {
    const line = recorded[i];
    assert.equal(r.outcomes.band.recorded, line.band);
    assert.equal(r.outcomes.band.same, true, r.id ?? "");
    assert.equal(r.version, "0.1.0");
    assert.equal(r.version_matches, true);
    // The rule that fired agrees with what the script recorded beside the band.
    const rule = r.outcomes.band.rule;
    assert.equal(rule === 1, line.needs_person_for.length > 0, r.id ?? "");
    assert.equal(rule === 2, line.needs_person_for.length === 0 && line.uncertain_triggers.length > 0, r.id ?? "");
    // The answers are read as typed: the choice with its distribution, each trigger as a probability of yes.
    const advance = r.run!.results.find((x) => x.decision === "advance")!.answer!;
    assert.ok(advance.type === "choice" && advance.choice === line.choice && advance.confidence === line.confidence);
    for (const [name, p] of Object.entries(line.triggers)) {
      assert.deepEqual(r.run!.results.find((x) => x.decision === name)!.answer, { type: "noul", yes: p });
    }
  });

  // The fifth run is the only one the uncertain band decided: foreign_repo read 0.47.
  const fifth = replay.runs[4].run!.results.find((x) => x.decision === "band")!;
  assert.equal(fifth.trace![0].held, false);
  assert.equal(fifth.trace![1].held, true);
  assert.equal(fifth.trace![1].reads["foreign_repo.yes"], 0.47);

  assert.match(formatLedgerReplay(replay), /^AdvanceGate 0\.1\.0: 16 line\(s\), of which 7 run\(s\), 8 ruling\(s\), 1 withdrawal\(s\)\n7 of 7 run\(s\) replayed: 7 give what was recorded, 0 differ\n/);
});

test("every caller of the evaluator gets the same outcome and rule trace for a recorded run", () => {
  const lines = ledger();
  const once = JSON.stringify(replayLedger(gate(), lines));
  assert.equal(JSON.stringify(replayLedger(gate(), lines)), once);
  // A run evaluated on its own, from the answers the replay read, is the run the replay holds.
  const reading = readLedger(gate(), lines);
  const replay = replayLedger(gate(), lines);
  reading.runs.forEach((recorded, i) => {
    const [ruling] = replay.runs[i].rulings;
    const alone = evaluateDecisions(gate(), {
      values: recorded.values,
      answers: recorded.answers,
      rulings: { ruling: { outcome: ruling.outcome, by: ruling.by, words: ruling.words, at: ruling.at } },
    });
    assert.equal(JSON.stringify(alone), JSON.stringify(replay.runs[i].run));
  });
});

test("the rulings on the advance gate: seven stand, one was withdrawn, and the bar count is not reached", () => {
  const lines = ledger();
  const replay = replayLedger(gate(), lines);
  assert.deepEqual(replay.rulings, {
    in_force: 7,
    withdrawn: 1,
    unusable: [],
    unmatched_withdrawals: [],
    bar_after: 20,
    counted: "ruling",
    reached: false,
    against: { band: { same: 1, different: 6 }, advance: { same: 6, different: 1 } },
  });
  assert.deepEqual(
    replay.runs.map((r) => [r.rulings[0].outcome, r.rulings[0].line, r.run!.results.find((x) => x.decision === "ruling")!.status]),
    [
      ["advance", 2, "ruled"],
      ["look_first", 4, "ruled"],
      ["advance", 6, "ruled"],
      ["hold_for_person", 8, "ruled"],
      ["look_first", 10, "ruled"],
      ["advance", 16, "ruled"],
      // Line 13 landed on this run by mistake and line 15 withdrew it: line 14 is the one in force.
      ["advance", 14, "ruled"],
    ],
  );
  // What the loom computes agrees with every verdict the ledger does hold.
  const said = (v: "same" | "different") => (v === "same" ? "confirm" : "override");
  for (const r of replay.runs) {
    assert.equal(r.rulings.length, 1);
    const [ruling] = r.rulings;
    const line = lines[ruling.line - 1];
    assert.equal(said(ruling.against.advance), line.verdict, `line ${ruling.line}`);
    if (line.verdict_on_band !== undefined) assert.equal(said(ruling.against.band), line.verdict_on_band, `line ${ruling.line}`);
  }
  // The first four rulings never recorded a verdict on the band (Episode 564, J5). The ledger is not completed here.
  assert.deepEqual(lines.map((l, i) => (l.kind === "ruling" && l.verdict_on_band === undefined ? i + 1 : 0)).filter(Boolean), [2, 4, 6, 8]);
  // Without a ruling the person's decision awaits its owner, whatever the band said.
  const unruled = replayLedger(gate(), lines.filter((l) => l.kind === "decision"));
  assert.equal(unruled.rulings.in_force, 0);
  for (const r of unruled.runs) assert.equal(r.run!.results.find((x) => x.decision === "ruling")!.status, "awaiting_owner");
});

test("a line that lacks what the replay needs is said to, with the field, and nothing is put in its place", () => {
  const lines = ledger();
  delete lines[0].triggers.money;
  delete lines[2].confidence;
  lines[4].triggers.deletes = null;
  lines[6].questions_version = "0.0.9";
  const replay = replayLedger(gate(), lines);
  assert.deepEqual([replay.replayed, replay.same, replay.not_replayable, replay.version_differs], [5, 5, 2, 1]);

  const [first, second, third, fourth] = replay.runs;
  assert.equal(first.replayable, false);
  assert.deepEqual(first.lacks, ["the answer of money (triggers.money)"]);
  assert.equal(first.run, null);
  assert.equal(first.same, null);
  assert.deepEqual(second.lacks, ["the answer of advance (confidence)"]);

  // A null is an engine that did not answer: a recorded fact, replayed through the failure route.
  assert.equal(third.replayable, true);
  const band = third.run!.results.find((x) => x.decision === "band")!;
  assert.equal(band.status, "failed");
  assert.deepEqual(band.missing, ["deletes"]);
  assert.equal(band.outcome, "hold_for_person");
  assert.equal(third.outcomes.band.same, true);

  assert.equal(fourth.version_matches, false);
  assert.match(formatLedgerReplay(replay), /ag-20261114180612587: cannot be replayed, the line lacks the answer of money \(triggers\.money\)/);
  assert.match(formatLedgerReplay(replay), /1 run\(s\) recorded another version than the document's 0\.1\.0/);
});

test("a ledger in the format's own shape needs no map, and other bars can be tried on recorded answers", () => {
  const def = refund();
  def.rulings = { key: "run", bar_after: 2, decision: "sign_off" };
  const lines = [
    { kind: "decision", id: "r1", definition: { name: "Refund", version: "1.0.0" }, values: { message: "m", amount: 12 }, answers: ANSWERS, outcomes: { handling: "refund" } },
    { kind: "ruling", run: "r1", decision: "sign_off", outcome: "approve", decided_by: "Ada", words: "Yes.", at: "t1" },
    { kind: "decision", id: "r2", definition: { name: "Refund", version: "1.0.0" }, values: { message: "m", amount: 400 }, answers: ANSWERS, outcomes: { handling: "review" } },
    { kind: "ruling", run: "r2", decision: "sign_off", outcome: "refuse", decided_by: "Ada", words: "Too much.", at: "t2" },
    { kind: "note", text: "not a run" },
  ];
  const replay = replayLedger(def, lines);
  assert.deepEqual([replay.replayed, replay.same, replay.counts.other], [2, 2, 1]);
  assert.deepEqual([replay.rulings.in_force, replay.rulings.reached], [2, true]);
  assert.equal(replay.runs[0].rulings[0].words, "Yes.");

  const stricter = replayLedger(def, lines, { bars: { sure_at: 0.95 } });
  assert.deepEqual(stricter.bars, { sure_at: 0.95 });
  assert.deepEqual([stricter.same, stricter.different], [0, 2]);
  assert.equal(stricter.runs[0].outcomes.handling.replayed, "respond");
  // The document is untouched: trying a bar never sets it.
  assert.equal(def.bars![0].value, 0.8);
});

// ── The drawing ──────────────────────────────────────────────────────────────

test("the Mermaid drawing has DMN's shapes, tells the three kinds of logic apart, and boxes a group", () => {
  const text = renderMermaidDecisions(gate());
  assert.equal(text, renderMermaidDecisions(gate()));
  const lines = text.split("\n");
  assert.equal(lines[0], "flowchart BT");
  assert.ok(lines.includes('  i1(["action"])'));
  assert.ok(lines.includes('  k1>"JevStudy"]'));
  assert.ok(lines.includes('  k2[["SixTriggers"]]'));
  assert.ok(lines.includes('  k3>"PersonsWord<br/><i>authority</i>"]'));
  assert.ok(lines.includes('  subgraph g1["gate: one request"]'));
  assert.ok(lines.includes('    d2["deletes<br/><i>question · noul</i>"]:::question'));
  assert.ok(lines.includes('  d8["band<br/><i>table · first · 4 rules</i>"]'));
  assert.ok(lines.includes('  d9["ruling<br/><i>person · the seat; the person when a held trigger is theirs</i>"]:::person'));
  // Information, knowledge and authority are three kinds of line.
  for (const edge of ["  i1 --> d2", "  d8 --> d9", "  k2 -.-> d2", "  k3 -.-o d8"]) assert.ok(lines.includes(edge), edge);
  // A group is a box and never an arrow: no question points at another.
  assert.equal(lines.some((l) => /^ {2}d[1-7] --> d[1-7]$/.test(l)), false);
  assert.ok(lines.includes("  classDef question stroke-dasharray: 6 4"));

  // The drawing kept beside the example is this render, not a hand-drawn one.
  assert.equal(file("advance-gate.dmd.mmd"), text);

  const odd = refund();
  odd.decisions[0].name = 'asks "refund" <now>';
  Object.assign(odd.decisions[2], { machine: "Desk", event: "HandlingSelected" });
  const drawn = renderMermaidDecisions(odd);
  assert.match(drawn, /d1\["asks 'refund' 'now'<br\/>/);
  assert.match(drawn, /handling<br\/><i>table · first · 3 rules<\/i><br\/><i>fires HandlingSelected of Desk<\/i>/);
});

// ── A decision model in a system ─────────────────────────────────────────────

const DESK: StateMachineDefinition = {
  settings: { namespace: "demo", name: "Desk", asynchronous: false },
  events: [{ name: "Internal", events: [{ id: "Received" }, { id: "HandlingSelected" }, { id: "Ruled" }] }],
  state: {
    name: "Root",
    states: [
      { name: "Waiting", transitions: [{ event: "Received", nextState: "Evaluating" }] },
      { name: "Evaluating", transitions: [{ event: "HandlingSelected", nextState: "AwaitingOwner" }] },
      { name: "AwaitingOwner", transitions: [{ event: "Ruled", nextState: "Closed" }] },
      { name: "Closed", kind: "final" },
    ],
  },
} as StateMachineDefinition;

const members = (def: DecisionModelDefinition, extra: LoadedMember[] = []): LoadedMember[] => [
  { path: "desk.smdf.json", kind: "machine", def: DESK },
  { path: "refund.dmdf.json", kind: "decision", def },
  ...extra,
];
const system = { settings: { namespace: "demo", name: "RefundDesk" }, members: [{ path: "desk.smdf.json" }, { path: "refund.dmdf.json" }] };
const d008 = (def: DecisionModelDefinition, extra: LoadedMember[] = []) =>
  checkSystem(system, members(def, extra)).issues.filter((i) => i.ruleId.startsWith("D"));

test("a decision model is a member a system admits, and it stands alone as well", () => {
  assert.ok(MEMBER_KINDS.includes("decision"));
  assert.deepEqual(addMember({ settings: { namespace: "demo", name: "S" }, members: [] }, { path: "refund.dmdf.json" }).members, [{ path: "refund.dmdf.json" }]);
  assert.throws(() => addMember({ settings: { namespace: "demo", name: "S" }, members: [] }, { path: "notes.txt" }), /\.erdf\.json, \.smdf\.json, \.sqdf\.json, \.dmdf\.json/);
  assert.deepEqual(membersByKind(members(refund())).decisions.map((m) => m.member), ["refund.dmdf.json"]);
  assert.deepEqual(checkSystem(system, members(refund())).issues, []);
  // A member named as a decision model that holds something else is said to.
  const wrong = checkSystem(system, [{ path: "refund.dmdf.json", kind: "decision", def: DESK }]).issues;
  assert.ok(wrong.some((i) => i.ruleId === "Y003" && /named as a decision but holds machine/.test(i.message)));
});

test("D008: an outcome's event is an event of the machine it drives, and an input's entity is an entity", () => {
  const driving = refund();
  Object.assign(driving.decisions[2], { machine: "Desk", event: "HandlingSelected" });
  Object.assign(driving.decisions[3], { machine: "Desk", event: "Ruled" });
  assert.deepEqual(d008(driving), []);

  const lost = refund();
  Object.assign(lost.decisions[2], { machine: "Desk", events: { refund: "RefundChosen", respond: "HandlingSelected", review: "HandlingSelected" } });
  assert.deepEqual(d008(lost).map((i) => `${i.severity} ${i.message}`), ['error "handling" fires "RefundChosen" (outcome refund), which "Desk" does not define']);

  const elsewhere = refund();
  Object.assign(elsewhere.decisions[2], { machine: "Counter", event: "HandlingSelected" });
  assert.deepEqual(d008(elsewhere).map((i) => i.message), ['"handling" drives the machine "Counter", which is not a member']);

  const anyMachine = refund();
  Object.assign(anyMachine.decisions[2], { event: "Vanished" });
  assert.deepEqual(d008(anyMachine).map((i) => i.message), ['"handling" fires "Vanished" (outcomes refund, respond, review), which no member machine defines']);

  const typed = refund();
  typed.inputs![0].entity = "Message";
  assert.deepEqual(d008(typed).map((i) => `${i.severity} ${i.message}`), ["warning Inputs name entities, but the system has no ERD to hold them"]);
  const erd: LoadedMember = { path: "data.erdf.json", kind: "erd", def: { settings: { namespace: "demo", name: "data" }, entities: [{ name: "Ticket" }], relationships: [] } };
  assert.deepEqual(d008(typed, [erd]).map((i) => i.message), ['Input "message" is the entity "Message", which no member ERD defines']);
  typed.inputs![0].entity = "Ticket";
  assert.deepEqual(d008(typed, [erd]), []);

  // The model's own rules are reported with the system's, each at its severity.
  const flawed = refund();
  delete flawed.settings.version;
  flawed.settings.engine = "engine-0";
  assert.deepEqual(d008(flawed).map((i) => `${i.severity} ${i.ruleId} ${i.member}`), ["error D012 refund.dmdf.json", "warning D017 refund.dmdf.json"]);
});

// ── What an independent review found (2026-11-18), each kept as a test ───────

test("a document written in the wrong shape is reported, and no reader throws on it", () => {
  const wrong: [string, (d: Record<string, any>) => void, string][] = [
    ["bars as a map", (d) => void (d.bars = { sure_at: 0.8 }), "D018"],
    ["requires as one name", (d) => void (d.decisions[0].requires = "message"), "D003"],
    ["levels as a map", (d) => void (d.decisions[1].logic = { kind: "question", type: "score", instructions: "How urgent is `message`?", levels: { "0": "low", "1": "high" } }), "D005"],
    ["groups as a map", (d) => void (d.groups = { desk: ["asks_refund"] }), "D010"],
    ["a group's questions as one name", (d) => void (d.groups = [{ name: "desk", questions: "asks_refund" }]), "D010"],
    ["a record path that is a number", (d) => void (d.rulings = { record: { values: { message: 5 }, version: 2 } }), "D022"],
    ["a decision that is null", (d) => void d.decisions.push(null), "D002"],
    ["rules as a map", (d) => void (d.decisions[2].logic.rules = { first: "x" }), "D006"],
    ["options as a list", (d) => void (d.decisions[1].logic.options = ["billing", "delivery"]), "D005"],
    ["events as a list", (d) => void (d.decisions[2].events = ["Refund"]), "D013"],
    ["a failure route as a word", (d) => void (d.decisions[2].logic.failure = "review"), "D015"],
    ["inputs as a map", (d) => void (d.inputs = { message: {} }), "D002"],
    ["rulings as a list", (d) => void (d.rulings = []), "D022"],
    ["binding as a word", (d) => void (d.binding = "engine-1"), "D017"],
  ];
  const lines = [
    { kind: "decision", id: "r1", values: { message: "m", amount: 12 }, answers: ANSWERS, outcomes: { handling: "refund" } },
    { kind: "ruling", decision_id: "r1", decision: "sign_off", outcome: "approve", decided_by: "Ada" },
  ];
  for (const [what, change, rule] of wrong) {
    const def = refund() as unknown as Record<string, any>;
    change(def);
    const model = def as unknown as DecisionModelDefinition;
    assert.ok(validateDecisionModel(model).some((e) => e.ruleId === rule && e.severity !== "warning"), `${what}: ${ids(model).join(" ")}`);
    assert.doesNotThrow(() => evaluateDecisions(model, { values: { message: "m", amount: 12 }, answers: ANSWERS }), what);
    assert.doesNotThrow(() => renderMermaidDecisions(model), what);
    assert.doesNotThrow(() => replayLedger(model, lines), what);
    assert.doesNotThrow(() => requestGroups(model), what);
    // The request refuses with a sentence when it cannot be built. It never fails on the document's shape.
    try {
      toEngineRequest(model, { message: "m", amount: 12 });
    } catch (e) {
      assert.ok(e instanceof Error && !(e instanceof TypeError) && !(e instanceof RangeError), `${what}: ${String(e)}`);
    }
  }
  // Not a document at all.
  for (const nothing of [null, undefined, 7, "x", [], { decisions: "many" }]) {
    const model = nothing as unknown as DecisionModelDefinition;
    assert.ok(validateDecisionModel(model).length > 0);
    assert.deepEqual(evaluateDecisions(model).results, []);
    assert.equal(renderMermaidDecisions(model).split("\n")[0], "flowchart BT");
    assert.equal(replayLedger(model, lines).replayed, 1);
  }
  // A caller's own arguments may be null.
  assert.doesNotThrow(() => evaluateDecisions(refund(), null));
  assert.doesNotThrow(() => evaluateDecisions(refund(), { bars: null, values: null as never, answers: null as never, rulings: null as never }));
  // A document made safe is returned as it is when asked again.
  const once = safeModel(refund());
  assert.equal(safeModel(once), once);
});

test("a name every JavaScript object carries is refused, and never answers for the document", () => {
  // Refused by the rules.
  const named = (f: (d: DecisionModelDefinition) => void): string[] => {
    const def = refund();
    f(def);
    return errors(def);
  };
  assert.ok(named((d) => void (d.inputs![0].name = "constructor")).includes("D002"));
  assert.ok(named((d) => void (d.decisions[3].name = "toString")).includes("D002"));
  assert.deepEqual(named((d) => void d.bars!.push({ name: "__proto__", value: 0.5 })), ["D018"]);
  assert.deepEqual(named((d) => void (d.groups = [{ name: "valueOf", questions: ["asks_refund"] }])), ["D010"]);
  assert.ok(named((d) => void ((d.decisions[1].logic as { options: Record<string, string> }).options = { hasOwnProperty: "x", billing: "y" })).includes("D005"));

  // And harmless where a document that was never checked is run anyway.
  const def = refund();
  def.inputs!.push({ name: "constructor" });
  def.decisions[2].requires!.push("constructor");
  (def.decisions[2].logic as { rules: { if: string }[] }).rules[0].if = "constructor >= sure_at";
  const tried = evaluateDecisions(def, { values: { constructor: 0.1, amount: 12 }, answers: ANSWERS, bars: { constructor: 0.9, toString: 3, sure_at: 0.05 } });
  assert.deepEqual(tried.bars, { sure_at: 0.05 }, "an override never adds a bar");
  assert.deepEqual(result(tried, "handling").trace![0].reads, { constructor: 0.1, sure_at: 0.05 });

  const odd = refund();
  odd.decisions[0].name = "toString";
  odd.decisions[3].name = "constructor";
  const run = evaluateDecisions(odd, { values: { amount: 12 } });
  assert.equal(result(run, "toString").status, "missing");
  assert.deepEqual(result(run, "constructor"), { decision: "constructor", kind: "person", status: "awaiting_owner", who: "the desk manager" });

  // A rule cannot read what an answer does not hold.
  const env = ruleEnvOf(refund(), refund().decisions[2]);
  assert.match(checkRule(tree("asks_refund.constructor == asks_refund.constructor"), env)[0], /a noul answer has no `constructor`/);
  assert.match(checkRule(tree("asks_refund.__proto__ == 1"), env)[0], /a noul answer has no `__proto__`/);
});

test("a table that requires a decision still awaiting its owner never takes its failure route", () => {
  // `risk` is not answered and `sign_off` is not ruled. Whichever a rule reads first, the payout waits.
  const model = (hit: string, rules: object[]): DecisionModelDefinition => ({
    settings: { namespace: "demo", name: "Payout", version: "1" },
    inputs: [{ name: "message" }],
    decisions: [
      { name: "risk", logic: { kind: "question", type: "noul", instructions: "Is `message` risky?", criteria: { true: "It is." } }, requires: ["message"] },
      { name: "sign_off", logic: { kind: "person", who: "the desk manager" }, outcomes: ["approve", "refuse"] },
      { name: "payout", logic: { kind: "table", hit, rules, failure: { then: "pay" } } as never, requires: ["risk", "sign_off"], outcomes: ["pay", "close"] },
    ],
  });
  const safe = { when: "not risky", if: "risk.yes < 0.5", then: "pay" };
  const approved = { when: "approved", if: 'sign_off.outcome == "approve"', then: "pay" };
  const both = { when: "not risky and approved", if: 'risk.yes < 0.5 and sign_off.outcome == "approve"', then: "pay" };
  const last = { when: "otherwise", if: "otherwise", then: "close" };
  for (const hit of ["first", "unique", "collect"]) {
    for (const rules of [[safe, approved], [approved, safe], [both, last]]) {
      const def = model(hit, rules);
      const payout = result(evaluateDecisions(def, { values: { message: "m" } }), "payout");
      assert.equal(payout.status, "awaiting_owner", `${hit} ${JSON.stringify(rules.map((r) => r.when))}`);
      assert.equal(payout.outcome, undefined);
      assert.equal(payout.outcomes, undefined);
      assert.deepEqual(payout.awaiting, ["sign_off"]);
    }
  }
  // Once the person has ruled, the engine's failure is the table's to route.
  const ruled = evaluateDecisions(model("first", [both, last]), { values: { message: "m" }, rulings: { sign_off: { outcome: "refuse", by: "Ada" } } });
  assert.equal(result(ruled, "payout").status, "failed");
  assert.equal(result(ruled, "payout").outcome, "pay");
  assert.match(formatDecisionRun(evaluateDecisions(model("first", [safe, approved]), { values: { message: "m" } })), /payout: awaiting its owner \(sign_off\); no valid answer for risk either/);
});

test("a collecting table that fails gives its failure route as what it collected", () => {
  const def: DecisionModelDefinition = {
    settings: { namespace: "demo", name: "Flags", version: "1" },
    inputs: [{ name: "message" }],
    decisions: [
      { name: "late", logic: { kind: "question", type: "noul", instructions: "Is `message` late?", criteria: { true: "It is." } }, requires: ["message"] },
      { name: "flags", logic: { kind: "table", hit: "collect", rules: [{ when: "late", if: "late.yes >= 0.5", then: "late" }], failure: { then: "unknown" } }, requires: ["late"], outcomes: ["late", "unknown"] },
      {
        name: "route",
        logic: {
          kind: "table",
          hit: "first",
          rules: [
            { when: "nothing is known", if: 'collected(flags, "unknown")', then: "desk" },
            { when: "otherwise", if: "flags.count > 0 or otherwise", then: "queue" },
          ],
        } as never,
        requires: ["flags"],
        outcomes: ["desk", "queue"],
      },
    ],
  };
  (def.decisions[2].logic as { rules: { if: string }[] }).rules[1].if = "otherwise";
  assert.deepEqual(errors(def), []);
  const run = evaluateDecisions(def, { values: { message: "m" } });
  assert.deepEqual([result(run, "flags").status, result(run, "flags").outcomes], ["failed", ["unknown"]]);
  assert.deepEqual([result(run, "route").status, result(run, "route").outcome], ["decided", "desk"]);
  assert.match(formatDecisionRun(run), /flags: unknown, by its failure route/);
});

test("a choice decides one of its options, whatever outcomes it also writes", () => {
  const def = refund();
  const table = def.decisions[2];
  (table.logic as { rules: object[] }).rules[1] = { when: "the category decides", if: "answered(category)", from: "category" };
  table.outcomes = ["refund", "respond", "review", "billing"];
  def.decisions[1].outcomes = ["billing"];
  assert.deepEqual(outcomesOf(def.decisions[1]), ["billing", "delivery", "other"]);
  // D005 says the choice's outcomes are not its options, and D006 that the table cannot take every option.
  assert.deepEqual(errors(def), ["D005", "D006"]);
  def.decisions[1].outcomes = ["other", "billing", "delivery"];
  table.outcomes = ["refund", "respond", "review", "billing", "delivery", "other"];
  assert.deepEqual(errors(def), []);
});

test("options named with whole numbers cannot be sent in another order, and that is said", () => {
  const def = refund();
  (def.decisions[1].logic as { options: Record<string, string>; rotate?: boolean }).options = { "1": "A charge.", "2": "A parcel.", "3": "Neither." };
  assert.deepEqual(errors(def), []);
  assert.deepEqual(Object.keys(toEngineRequest(def, { message: "m" }).questions.category.criteria as object), ["1", "2", "3"]);
  assert.throws(() => toEngineRequest(def, { message: "m" }, { optionOrder: { category: ["3", "1", "2"] } }), /cannot be sent in another order/);
  (def.decisions[1].logic as { rotate?: boolean }).rotate = true;
  assert.deepEqual(errors(def), ["D005"]);
  assert.throws(() => toEngineRequest(def, { message: "m" }, { rotation: 1 }), /named with a whole number \(1, 2, 3\)/);
  // The turn that changes nothing is still the order written.
  assert.doesNotThrow(() => toEngineRequest(def, { message: "m" }, { rotation: 3 }));
});

test("a group does not take a name the loom gives its own requests", () => {
  const def = refund();
  def.decisions.push({ name: "urgent", logic: { kind: "question", type: "noul", instructions: "Is `message` urgent?", criteria: { true: "It asks for today." } }, requires: ["message"] });
  def.decisions[2].requires!.push("urgent");
  def.groups = [{ name: "default", questions: ["asks_refund"] }];
  assert.deepEqual(errors(def), ["D010"]);
  // Even unchecked, every request has a name of its own and can be asked for.
  assert.deepEqual(requestGroups(def).map((g) => g.name), ["default", "default-2"]);
  assert.deepEqual(Object.keys(toEngineRequest(def, { message: "m" }, { group: "default-2" }).questions), ["category", "urgent"]);
  def.groups = [{ name: "category", questions: ["asks_refund"] }];
  assert.deepEqual(errors(def), ["D010"]);
});

test("an invalid answer reads the same whatever order its keys arrived in", () => {
  const choice = refund().decisions[1].logic as never;
  const a = readAnswer(choice, { choice: "billing", confidence: 0.5, probabilities: { billing: 0.5, delivery: 0.2, other: 0.1, y: 0.1, x: 0.1 } });
  const b = readAnswer(choice, { probabilities: { x: 0.1, y: 0.1, other: 0.1, delivery: 0.2, billing: 0.5 }, confidence: 0.5, choice: "billing" });
  assert.equal(a.status, "invalid");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

const TWO_PEOPLE = (): DecisionModelDefinition => ({
  settings: { namespace: "demo", name: "TwoKeys", version: "1" },
  inputs: [{ name: "message" }],
  decisions: [
    { name: "extra", logic: { kind: "question", type: "noul", instructions: "Is `message` long?", criteria: { true: "It is." } }, requires: ["message"] },
    { name: "seat", logic: { kind: "person", who: "the seat" }, outcomes: ["go", "stop"] },
    { name: "owner", logic: { kind: "person", who: "the owner" }, outcomes: ["go", "stop"] },
    {
      name: "final",
      logic: {
        kind: "table",
        hit: "first",
        rules: [
          { when: "both say go", if: 'seat.outcome == "go" and owner.outcome == "go"', then: "go" },
          { when: "otherwise", if: "otherwise", then: "stop" },
        ],
      },
      requires: ["seat", "owner"],
      outcomes: ["go", "stop"],
    },
  ],
  rulings: { key: "run", bar_after: 2 },
});

test("a run keeps the ruling of each person who ruled on it", () => {
  const lines = [
    { kind: "decision", id: "r1", outcomes: { final: "go" } },
    { kind: "ruling", run: "r1", decision: "seat", outcome: "go", decided_by: "mia", at: "t1" },
    { kind: "ruling", run: "r1", decision: "owner", outcome: "go", decided_by: "Guillaume", at: "t2" },
  ];
  const replay = replayLedger(TWO_PEOPLE(), lines);
  const [run] = replay.runs;
  // `extra` is read by no table: a line that never kept it is still replayed.
  assert.equal(run.replayable, true);
  assert.deepEqual(run.lacks, []);
  assert.deepEqual(run.run!.results.map((r) => `${r.decision}:${r.status}`), ["extra:missing", "seat:ruled", "owner:ruled", "final:decided"]);
  assert.equal(run.outcomes.final.same, true);
  assert.deepEqual(run.rulings.map((r) => [r.decision, r.by]), [["seat", "mia"], ["owner", "Guillaume"]]);
  assert.deepEqual([replay.rulings.in_force, replay.rulings.reached, replay.rulings.counted], [2, true, null]);
  assert.match(formatLedgerReplay(replay), /r1: final go by rule 1, recorded go: same · seat ruled go by mia · owner ruled go by Guillaume/);

  // Counted against the bar: only the decision the document names, when it names one.
  const owned = TWO_PEOPLE();
  owned.rulings!.decision = "owner";
  const counted = replayLedger(owned, lines).rulings;
  assert.deepEqual([counted.in_force, counted.reached, counted.counted], [1, false, "owner"]);
});

test("a ruling that cannot stand, and a withdrawal that finds nothing, are reported and never counted", () => {
  const lines = [
    { kind: "decision", id: "r1", outcomes: { final: "stop" } },
    { kind: "ruling", run: "no-such-run", decision: "seat", outcome: "go", decided_by: "mia" },
    { kind: "ruling", run: "r1", decision: "seat", decided_by: "mia" },
    { kind: "ruling", run: "r1", decision: "owner", outcome: "go" },
    { kind: "ruling", run: "r1", decision: "final", outcome: "go", decided_by: "mia" },
    { kind: "ruling", run: "r1", decision: "seat", outcome: "perhaps", decided_by: "mia" },
    { kind: "ruling", run: "r1", outcome: "go", decided_by: "mia" },
    null,
    { kind: "ruling", run: "r1", decision: "seat", outcome: "go", decided_by: "mia", at: "2026-11-14T18:53:07.326Z" },
    { kind: "ruling_withdrawn", run: "r1", withdrawn_ruling_at: "2026-11-14T18:53:07Z" },
  ];
  const replay = replayLedger(TWO_PEOPLE(), lines);
  assert.equal(replay.lines, 9, "a line left out is not a line read, and the others keep their numbers");
  assert.deepEqual(replay.rulings.unusable, [
    { line: 2, why: 'the ledger holds no run "no-such-run"' },
    { line: 3, why: "it rules nothing (no outcome)" },
    { line: 4, why: "it does not say who ruled" },
    { line: 5, why: '"final" is not a person\'s decision of the model' },
    { line: 6, why: 'it rules "perhaps", which is not an outcome of "seat"' },
    { line: 7, why: "it does not say which person's decision it rules, and the model has more than one" },
  ]);
  assert.deepEqual(replay.rulings.unmatched_withdrawals, [10]);
  assert.deepEqual([replay.rulings.in_force, replay.rulings.withdrawn, replay.rulings.reached], [1, 0, false]);
  assert.deepEqual(replay.runs[0].rulings.map((r) => [r.decision, r.line]), [["seat", 9]]);
  // The owner has not ruled, so the table that reads both still waits.
  assert.equal(replay.runs[0].run!.results.find((r) => r.decision === "final")!.status, "awaiting_owner");
  const text = formatLedgerReplay(replay);
  assert.match(text, /the ruling on line 4 is not counted: it does not say who ruled/);
  assert.match(text, /the withdrawal\(s\) on line 10 found no ruling to withdraw/);
});

test("a ruling is compared with what the replay gives, under the bars the replay ran", () => {
  const lines = ledger();
  const own = replayLedger(gate(), lines);
  assert.deepEqual(own.rulings.against.band, { same: 1, different: 6 });
  assert.match(formatLedgerReplay(own), /compared with what the replay gives, band: 1 the same, 6 different; advance: 6 the same, 1 different$/);
  // With the owner's bar and the uncertain band out of reach, the third run takes the engine's choice,
  // and the ruling on it, which was "advance", then agrees with the band.
  const tried = replayLedger(gate(), lines, { bars: { owner_at: 0.99, uncertain_from: 0.98, uncertain_to: 0.99 } });
  assert.equal(tried.runs[2].outcomes.band.replayed, "advance");
  assert.equal(tried.runs[2].rulings[0].against.band, "same");
  assert.deepEqual(tried.rulings.against.band, { same: 2, different: 5 });
});

test("a model past the loom's bound is refused whole, and a long chain is walked without a stack", () => {
  const chain = (n: number): DecisionModelDefinition => ({
    settings: { namespace: "demo", name: "Chain", version: "1" },
    inputs: [{ name: "n", type: "number" }],
    decisions: Array.from({ length: n }, (_, i) => ({
      name: `t${i}`,
      logic: { kind: "table", hit: "first", rules: [{ when: "always", if: "otherwise", then: "on" }] } as never,
      requires: [i === 0 ? "n" : `t${i - 1}`],
      outcomes: ["on"],
    })),
  });
  const long = chain(DMD_LIMITS.MAX_DECISIONS);
  assert.deepEqual(errors(long), []);
  assert.equal(evaluateDecisions(long, { values: { n: 1 } }).results.at(-1)!.outcome, "on");

  const tooLong = chain(DMD_LIMITS.MAX_DECISIONS + 1);
  assert.deepEqual(errors(tooLong), ["D002"]);
  const refused = evaluateDecisions(tooLong, { values: { n: 1 } });
  assert.deepEqual(refused.results, []);
  assert.match(refused.problem!, /501 decisions, more than the 500/);
  // A circle in a long chain is still found.
  long.decisions[0].requires = ["n", `t${DMD_LIMITS.MAX_DECISIONS - 1}`];
  assert.deepEqual(errors(long), ["D004"]);
});

test("a note written as a list of paragraphs is text for every reader of a decision model", () => {
  const def = refund() as unknown as Record<string, any>;
  def.settings.notes = ["one", "two"];
  def.decisions[2].notes = ["why review?"];
  def.decisions[2].logic.rules[0].notes = ["small means 25 or less"];
  def.inputs[0].notes = [];
  const read = normalizeNotes(def) as Record<string, any>;
  assert.equal(read.settings.notes, "one\n\ntwo");
  assert.equal(read.decisions[2].notes, "why review?");
  assert.equal(read.decisions[2].logic.rules[0].notes, "small means 25 or less");
  assert.equal("notes" in read.inputs[0], false);
});
