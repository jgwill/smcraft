/**
 * `evaluateDecisions` — one run of a decision model from recorded answers (Spec 85).
 *
 * Given a document, the input values, the engine's recorded answers and any
 * recorded rulings, it returns what each decision is in that run and, for a
 * table, which rule decided it and what each rule read. It asks no engine and
 * reads no clock: the same document and the same answers give the same trace,
 * byte for byte, in every caller.
 *
 * What a decision can be in a run:
 *
 * - a question is `answered`, `missing` (the engine gave nothing) or `invalid`
 *   (the answer broke its contract, so no number is read from it);
 * - a table is `decided`, or `failed` (an answer it reads is missing or
 *   invalid: it goes to its failure route), or `awaiting_owner` (it reads a
 *   ruling that has not been given), or it has no outcome and says why
 *   (`no_rule`, `conflict`, `error`, `not_evaluable`);
 * - a person's decision is `awaiting_owner` until a ruling is recorded for it,
 *   and then `ruled`. Nothing here computes it: no rule, no bar, no failure
 *   route. Waiting is not failing.
 *
 * Never throws on a document it can read.
 *
 * Pure — no I/O.
 */
import { readAnswer, type TypedAnswer } from "./answers.js";
import {
  barsOf,
  decisionsInOrder,
  outcomesOf,
  type DecisionModelDefinition,
  type DmdDecision,
  type DmdTableLogic,
} from "./definition.js";
import { RuleStop, evalRule, parseRule, type RuleScope, type RuleValue } from "./expression.js";

/** A ruling as it was recorded: who ruled, what, and their words, which are never edited. */
export interface DmdRuling {
  outcome: string;
  by: string;
  words?: string | null;
  at?: string;
}

export interface DecisionRunInput {
  /** Each input's value, by name. */
  values?: Record<string, unknown>;
  /** Each question's recorded answer, by name, as the engine gave it. */
  answers?: Record<string, unknown>;
  /** Each person's recorded ruling, by decision name. */
  rulings?: Record<string, DmdRuling | null | undefined>;
  /** Bars to try in place of the document's. A bar the document does not have is ignored. */
  bars?: Record<string, number>;
}

export type DmdResultStatus =
  | "answered"
  | "missing"
  | "invalid"
  | "decided"
  | "failed"
  | "awaiting_owner"
  | "ruled"
  | "no_rule"
  | "conflict"
  | "error"
  | "not_evaluable";

/** One rule of a table in one run. `held` is null when the rule could not be settled. */
export interface DmdRuleTrace {
  rule: number;
  when: string;
  held: boolean | null;
  /** What the rule read, as it wrote it: `{ "deletes.yes": 0.85, "owner_at": 0.5 }`. */
  reads: Record<string, RuleValue>;
  /** Why it could not be settled. */
  stopped?: string;
}

export interface DmdDecisionResult {
  decision: string;
  kind: "question" | "table" | "person" | "unknown";
  status: DmdResultStatus;
  /** A table's or a person's outcome. */
  outcome?: string;
  /** A `collect` table's outcomes, in rule order. */
  outcomes?: string[];
  /** The rule that decided a table (from 1). */
  rule?: number;
  /** Every rule that held, for `collect`, and for `unique` when several did. */
  rules?: number[];
  /** A table's rules in the order they were tried, up to where the run stopped. */
  trace?: DmdRuleTrace[];
  /** A question's answer, typed. */
  answer?: TypedAnswer;
  /** Why an answer is invalid. */
  failures?: string[];
  /** The unanswered questions a failed table read. */
  missing?: string[];
  /** The person's decisions an awaiting table reads. */
  awaiting?: string[];
  /** Who rules a person's decision. */
  who?: string;
  by?: string;
  words?: string | null;
  at?: string;
  /** Why there is no outcome. */
  message?: string;
}

export interface DecisionRun {
  definition: { namespace: string; name: string; version: string | null };
  /** The bars this run was read against. */
  bars: Record<string, number>;
  /** One result per decision, each after what it requires. */
  results: DmdDecisionResult[];
}

export function evaluateDecisions(def: DecisionModelDefinition, input: DecisionRunInput = {}): DecisionRun {
  const values = input.values ?? {};
  const answers = input.answers ?? {};
  const rulings = input.rulings ?? {};
  const bars = barsOf(def, input.bars);
  const inputs = new Set((def.inputs ?? []).filter((i) => i?.name).map((i) => i.name));
  const done = new Map<string, DmdDecisionResult>();
  const byName = new Map((def.decisions ?? []).filter((d) => d?.name).map((d) => [d.name, d]));

  /** A required decision's single outcome, or the stop that says why it has none. */
  const outcomeOf = (name: string): string => {
    const r = done.get(name);
    if (!r) throw new RuleStop("error", `\`${name}\` was not evaluated before it was read: the requirements go in a circle`, name);
    if (r.status === "awaiting_owner") throw new RuleStop("awaiting", `\`${name}\` awaits its owner`, name);
    if (r.kind === "question") {
      if (r.status !== "answered") throw new RuleStop("missing", `\`${name}\` has no valid answer`, name);
      if (r.answer?.type !== "choice") throw new RuleStop("error", `\`${name}\` is a ${r.answer?.type} answer and gives no outcome`, name);
      return r.answer.choice;
    }
    if (r.outcome === undefined) throw new RuleStop("error", `\`${name}\` has no outcome (${r.status})`, name);
    return r.outcome;
  };

  const scopeFor = (table: DmdDecision): RuleScope => {
    const requires = new Set(table.requires ?? []);
    const required = (name: string): void => {
      if (!requires.has(name)) throw new RuleStop("error", `the rule reads \`${name}\`, which "${table.name}" does not require`, name);
    };
    return {
      read(name, path) {
        const text = [name, ...path].join(".");
        if (Object.hasOwn(bars, name)) {
          if (path.length) throw new RuleStop("error", `\`${name}\` is a bar: \`${text}\` reads nothing`, name);
          return bars[name];
        }
        if (inputs.has(name)) {
          required(name);
          if (path.length) throw new RuleStop("error", `\`${name}\` is an input: \`${text}\` reads nothing`, name);
          const v = values[name];
          if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") {
            throw new RuleStop("error", `the input \`${name}\` has no value in this run`, name);
          }
          return v;
        }
        const d = byName.get(name);
        if (!d) throw new RuleStop("error", `the rule reads \`${name}\`, which is not an input, a bar or a decision of the model`, name);
        required(name);
        const r = done.get(name);
        if (!r) throw new RuleStop("error", `\`${name}\` was not evaluated before it was read: the requirements go in a circle`, name);
        if (r.kind === "question") {
          if (r.status !== "answered" || !r.answer) throw new RuleStop("missing", `\`${name}\` has no valid answer`, name);
          const answer = r.answer as unknown as Record<string, unknown>;
          if (!path.length) throw new RuleStop("error", `\`${name}\` is a ${r.answer.type} answer, not one number: read one of its fields`, name);
          const field = path[0] === "type" ? undefined : answer[path[0]];
          if (path.length === 1 && (typeof field === "number" || typeof field === "string")) return field;
          if (path.length === 2 && path[0] === "probabilities" && field && typeof field === "object") {
            const p = (field as Record<string, unknown>)[path[1]];
            if (typeof p === "number") return p;
          }
          throw new RuleStop("error", `a ${r.answer.type} answer has no \`${path.join(".")}\``, name);
        }
        if (r.status === "awaiting_owner") throw new RuleStop("awaiting", `\`${name}\` awaits its owner`, name);
        if (path.length === 1 && path[0] === "count" && r.outcomes) return r.outcomes.length;
        if (path.length !== 1 || path[0] !== "outcome") throw new RuleStop("error", `read \`${name}.outcome\`, not \`${text}\``, name);
        if (r.outcomes) throw new RuleStop("error", `\`${name}\` collects: ask collected(${name}, "…")`, name);
        if (r.outcome === undefined) throw new RuleStop("error", `\`${name}\` has no outcome (${r.status})`, name);
        return r.outcome;
      },
      answered(name) {
        required(name);
        const r = done.get(name);
        // Only a question can be asked this: whether a person has ruled is never a rule's to route around.
        if (!r || r.kind !== "question") throw new RuleStop("error", `answered() asks about a question, and \`${name}\` is not one`, name);
        return r.status === "answered";
      },
      collected(name, outcome) {
        required(name);
        const r = done.get(name);
        if (!r || r.kind !== "table") throw new RuleStop("error", `collected() asks about a table, and \`${name}\` is not one`, name);
        if (r.status === "awaiting_owner") throw new RuleStop("awaiting", `\`${name}\` awaits its owner`, name);
        if (!r.outcomes) throw new RuleStop("error", `\`${name}\` does not collect: read \`${name}.outcome\``, name);
        return r.outcomes.includes(outcome);
      },
    };
  };

  const table = (d: DmdDecision, logic: DmdTableLogic): DmdDecisionResult => {
    const base = { decision: d.name, kind: "table" as const };
    const rules = Array.isArray(logic.rules) ? logic.rules : [];
    const outcomes = outcomesOf(d);
    if (!rules.length) return { ...base, status: "error", message: "the table has no rule" };
    const wordsOnly = rules.map((r, i) => (r?.if === undefined ? i + 1 : 0)).filter(Boolean);
    if (wordsOnly.length) {
      return { ...base, status: "not_evaluable", message: `rule(s) ${wordsOnly.join(", ")} are written in words only; the loom does not run them` };
    }
    if (logic.hit !== "first" && logic.hit !== "unique" && logic.hit !== "collect") {
      return { ...base, status: "error", message: `the table states no hit policy the loom knows ("${String(logic.hit ?? "")}")` };
    }

    const scope = scopeFor(d);
    const trace: DmdRuleTrace[] = [];
    const held: number[] = [];
    const given: string[] = [];
    const stop = (e: RuleStop, reads: Record<string, RuleValue>, n: number, when: string): DmdDecisionResult => {
      trace.push({ rule: n, when, held: null, reads, stopped: e.message });
      if (e.kind === "awaiting") return { ...base, status: "awaiting_owner", awaiting: e.subject ? [e.subject] : [], trace };
      if (e.kind === "missing") {
        const route = logic.failure?.then;
        return {
          ...base,
          status: "failed",
          ...(route !== undefined && outcomes.includes(route) ? { outcome: route } : {}),
          missing: e.subject ? [e.subject] : [],
          message: route === undefined ? "an answer the table reads is missing, and it declares no failure route" : `rule ${n} read an answer that is missing or invalid; the table goes to its failure route`,
          trace,
        };
      }
      return { ...base, status: "error", message: `rule ${n}: ${e.message}`, trace };
    };

    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      const n = i + 1;
      const when = typeof rule.when === "string" ? rule.when : "";
      const parsed = parseRule(rule.if);
      if (!parsed.ok) return { ...base, status: "error", message: `rule ${n} cannot be read: ${parsed.error}`, trace };
      const reads: Record<string, RuleValue> = {};
      let holds: boolean;
      try {
        holds = evalRule(parsed.ast, scope, reads);
      } catch (e) {
        if (e instanceof RuleStop) return stop(e, reads, n, when);
        throw e;
      }
      if (!holds) {
        trace.push({ rule: n, when, held: false, reads });
        continue;
      }
      let outcome: string;
      try {
        outcome = rule.from !== undefined ? outcomeOf(rule.from) : String(rule.then ?? "");
      } catch (e) {
        if (e instanceof RuleStop) return stop(e, reads, n, when);
        throw e;
      }
      trace.push({ rule: n, when, held: true, reads });
      if (!outcomes.includes(outcome)) {
        return { ...base, status: "error", message: `rule ${n} gives "${outcome}", which is not one of the table's outcomes`, trace };
      }
      held.push(n);
      given.push(outcome);
      if (logic.hit === "first") return { ...base, status: "decided", outcome, rule: n, trace };
    }

    if (logic.hit === "collect") return { ...base, status: "decided", outcomes: given, rules: held, trace };
    if (held.length === 1) return { ...base, status: "decided", outcome: given[0], rule: held[0], trace };
    if (held.length > 1) {
      return { ...base, status: "conflict", rules: held, message: `rules ${held.join(", ")} hold together, and the table allows one`, trace };
    }
    return { ...base, status: "no_rule", message: "no rule holds", trace };
  };

  for (const d of decisionsInOrder(def)) {
    const logic = d.logic;
    let result: DmdDecisionResult;
    if (logic?.kind === "question") {
      const reading = readAnswer(logic, answers[d.name]);
      result =
        reading.status === "answered"
          ? { decision: d.name, kind: "question", status: "answered", answer: reading.answer }
          : reading.status === "invalid"
            ? { decision: d.name, kind: "question", status: "invalid", failures: reading.failures }
            : { decision: d.name, kind: "question", status: "missing" };
    } else if (logic?.kind === "table") {
      result = table(d, logic);
    } else if (logic?.kind === "person") {
      const who = typeof logic.who === "string" ? logic.who : "";
      const ruling = rulings[d.name];
      if (!ruling) {
        result = { decision: d.name, kind: "person", status: "awaiting_owner", who };
      } else if (typeof ruling.by !== "string" || !ruling.by.trim()) {
        result = { decision: d.name, kind: "person", status: "error", who, message: "the ruling does not say who ruled; a ruling is a person's, never a computed step" };
      } else if (!outcomesOf(d).includes(ruling.outcome)) {
        result = { decision: d.name, kind: "person", status: "error", who, message: `the ruling is "${ruling.outcome}", which is not one of ${outcomesOf(d).join(", ") || "its outcomes"}` };
      } else {
        result = {
          decision: d.name,
          kind: "person",
          status: "ruled",
          outcome: ruling.outcome,
          who,
          by: ruling.by,
          ...(ruling.words !== undefined ? { words: ruling.words } : {}),
          ...(ruling.at !== undefined ? { at: ruling.at } : {}),
        };
      }
    } else {
      // Not one of the loom's kinds of logic: reported, never guessed.
      result = { decision: d.name, kind: "unknown", status: "error", message: `the decision has no logic the loom knows ("${String((logic as { kind?: unknown } | undefined)?.kind ?? "")}")` };
    }
    done.set(d.name, result);
  }

  return {
    definition: {
      namespace: def.settings?.namespace ?? "",
      name: def.settings?.name ?? "",
      version: typeof def.settings?.version === "string" && def.settings.version.trim() ? def.settings.version : null,
    },
    bars,
    results: decisionsInOrder(def).map((d) => done.get(d.name)!),
  };
}

const short = (v: RuleValue): string => (typeof v === "number" ? String(Number(v.toFixed(4))) : JSON.stringify(v));

/** A run as lines a person can read: each decision, and for a table the rule that decided and what it read. */
export function formatDecisionRun(run: DecisionRun): string {
  const lines: string[] = [`${run.definition.name || "decision model"} ${run.definition.version ?? "(no version)"}`];
  const bars = Object.entries(run.bars);
  if (bars.length) lines.push(`bars: ${bars.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const r of run.results) {
    if (r.kind === "question") {
      const a = r.answer;
      const said =
        r.status !== "answered" || !a
          ? r.status === "invalid"
            ? `invalid (${(r.failures ?? []).join("; ")})`
            : "not answered"
          : a.type === "noul"
            ? `yes ${short(a.yes)}`
            : a.type === "choice"
              ? `${a.choice}, confidence ${short(a.confidence)} (${Object.entries(a.probabilities).map(([k, v]) => `${k} ${short(v)}`).join(", ")})`
              : `score ${short(a.score)}, confidence ${short(a.confidence)}`;
      lines.push(`${r.decision}: ${said}`);
      continue;
    }
    if (r.kind === "unknown") {
      lines.push(`${r.decision}: ${r.message ?? r.status}`);
      continue;
    }
    if (r.kind === "person") {
      lines.push(
        r.status === "ruled"
          ? `${r.decision}: ${r.outcome}, ruled by ${r.by}${r.words ? `: "${r.words}"` : ""}`
          : r.status === "awaiting_owner"
            ? `${r.decision}: awaiting its owner (${r.who})`
            : `${r.decision}: ${r.message ?? r.status}`,
      );
      continue;
    }
    const what =
      r.status === "decided"
        ? r.outcomes
          ? `${r.outcomes.join(", ") || "nothing"} (rules ${(r.rules ?? []).join(", ") || "none"})`
          : `${r.outcome} (rule ${r.rule})`
        : r.status === "failed"
          ? `${r.outcome ?? "no outcome"}, by its failure route (no valid answer for ${(r.missing ?? []).join(", ")})`
          : r.status === "awaiting_owner"
            ? `awaiting its owner (${(r.awaiting ?? []).join(", ")})`
            : `${r.status}: ${r.message ?? ""}`;
    lines.push(`${r.decision}: ${what}`);
    for (const t of r.trace ?? []) {
      const reads = Object.entries(t.reads).map(([k, v]) => `${k} ${short(v)}`).join(", ");
      const verdict = t.held === null ? "stopped" : t.held ? "holds" : "does not hold";
      lines.push(`  rule ${t.rule} ${verdict}: ${t.when}${reads ? ` [${reads}]` : ""}${t.stopped ? ` (${t.stopped})` : ""}`);
    }
  }
  return lines.join("\n");
}
