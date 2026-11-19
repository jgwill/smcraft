/**
 * A decision model's ledger, read and replayed (Spec 85).
 *
 * A ledger is the lines a caller kept: each run (`kind: "decision"`), each
 * ruling on a run (`kind: "ruling"`) and each withdrawal of a ruling
 * (`kind: "ruling_withdrawn"`). `replayLedger` runs every recorded run through
 * the document again, from the answers the line holds, and says for each
 * whether the tables give what was recorded. No engine is asked.
 *
 * Where a line does not hold something a table reads, the run is reported as
 * not replayable, with the field it lacks. Nothing is assumed in its place: a
 * key that is absent is a ledger that never kept it, while a `null` is an
 * engine that never answered, and the two are not the same finding.
 *
 * A ruling counts when it can stand: it names a run the ledger holds and a
 * person's decision of the model, rules one of that decision's outcomes, and
 * says who ruled. A ruling that cannot stand, and a withdrawal that finds no
 * ruling, are reported and never counted.
 *
 * Each ruling in force is compared with what the replay gives for the decisions
 * it answered (the table's outcome, the engine's choice). Under the document's
 * own bars that is what the ruling answered at the time; under bars a caller
 * tries, it is what the ruling would have met. That count is what a person
 * reads before moving a bar. The loom never moves one.
 *
 * Pure — no I/O. The caller reads the file and hands over its parsed lines,
 * with `null` for a line it left out so the others keep their numbers.
 */
import {
  decisionsInOrder,
  outcomesOf,
  own,
  safeModel,
  type DecisionModelDefinition,
  type DmdQuestionLogic,
} from "./definition.js";
import { evaluateDecisions, type DecisionRun, type DmdDecisionResult, type DmdResultStatus, type DmdRuling } from "./evaluate.js";

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

/** The value at a dot-separated path, `undefined` when any step is absent. */
function at(line: unknown, path: unknown): unknown {
  if (typeof path !== "string" || !path) return undefined;
  let here: unknown = line;
  for (const key of path.split(".")) {
    if (!isObject(here) || !Object.hasOwn(here, key)) return undefined;
    here = here[key];
  }
  return here;
}

export interface LedgerRun {
  /** The line's number in the ledger, from 1. */
  line: number;
  id: string | null;
  at?: string;
  /** The definition version the run recorded. */
  version: string | null;
  values: Record<string, unknown>;
  answers: Record<string, unknown>;
  /** The outcomes the line recorded, by decision. A table that collects is recorded as its outcomes joined by ", ". */
  recorded: Record<string, string>;
  /** What a table reads and the line never kept, each with where it was looked for. */
  lacks: string[];
}

export interface LedgerRuling {
  line: number;
  /** The run it answers. */
  run: string | null;
  /** The person's decision it is the outcome of. */
  decision: string | null;
  outcome: string | null;
  by: string | null;
  words: string | null;
  at?: string;
  /** False once a later line withdrew it. */
  standing: boolean;
  /** Why it cannot stand, when it cannot: it is then reported and never counted. */
  unusable?: string;
}

export interface LedgerReading {
  /** The lines read: every line the caller handed over that is not `null`. */
  lines: number;
  runs: LedgerRun[];
  rulings: LedgerRuling[];
  withdrawals: number;
  /** The line numbers of withdrawals that found no ruling to withdraw. */
  unmatched_withdrawals: number[];
  /** Lines that are none of the three. */
  other: number;
}

const ANSWER_PARTS: Record<DmdQuestionLogic["type"], string[]> = {
  noul: ["noul"],
  choice: ["choice", "confidence", "probabilities"],
  score: ["score", "confidence", "probabilities"],
};

export function readLedger(model: DecisionModelDefinition, lines: readonly unknown[]): LedgerReading {
  const def = safeModel(model);
  const record = def.rulings?.record;
  const key = typeof def.rulings?.key === "string" && def.rulings.key ? def.rulings.key : "decision_id";
  const decisions = decisionsInOrder(def);
  const byName = new Map(decisions.map((d) => [d.name, d]));
  const questions = decisions.filter((d) => d.logic?.kind === "question");
  const persons = decisions.filter((d) => d.logic?.kind === "person");
  // Only what a table reads is needed to replay a table: an answer or an input it requires.
  const tableReads = new Set<string>();
  for (const d of decisions) if (d.logic?.kind === "table") for (const r of d.requires ?? []) tableReads.add(r);

  const out: LedgerReading = { lines: 0, runs: [], rulings: [], withdrawals: 0, unmatched_withdrawals: [], other: 0 };
  lines.forEach((line, i) => {
    if (line === null || line === undefined) return;
    out.lines += 1;
    const kind = isObject(line) ? line.kind : undefined;
    if (kind === "decision") {
      const lacks: string[] = [];
      const values: Record<string, unknown> = {};
      for (const input of def.inputs ?? []) {
        if (typeof input.name !== "string" || !input.name) continue;
        const path = own(record?.values, input.name) ?? `values.${input.name}`;
        const v = at(line, path);
        if (v !== undefined) values[input.name] = v;
        else if (tableReads.has(input.name)) lacks.push(`the value of ${input.name} (${path})`);
      }
      const answers: Record<string, unknown> = {};
      for (const q of questions) {
        const logic = q.logic as DmdQuestionLogic;
        const needed = tableReads.has(q.name);
        const map = own(record?.answers, q.name);
        if (!map) {
          const v = at(line, `answers.${q.name}`);
          if (v !== undefined) answers[q.name] = v;
          else if (needed) lacks.push(`the answer of ${q.name} (answers.${q.name})`);
          continue;
        }
        const parts = (own(ANSWER_PARTS, logic.type) ?? []).map((part) => ({ part, path: own(map, part), value: at(line, own(map, part)) }));
        const absent = parts.filter((p) => p.value === undefined);
        if (absent.length || !parts.length) {
          if (needed) lacks.push(`the answer of ${q.name} (${absent.map((p) => p.path ?? `no path for ${p.part}`).join(", ") || "no question type"})`);
          continue;
        }
        // Every part null: the engine was asked and gave nothing. That is a recorded fact, and it replays as one.
        answers[q.name] = parts.every((p) => p.value === null) ? null : Object.fromEntries(parts.map((p) => [p.part, p.value]));
      }
      const recorded: Record<string, string> = {};
      const keep = (name: string, v: unknown): void => {
        if (!byName.has(name)) return;
        if (typeof v === "string") recorded[name] = v;
        else if (Array.isArray(v) && v.every((x) => typeof x === "string")) recorded[name] = v.join(", ");
      };
      const mapped = record?.outcomes;
      if (mapped) for (const [name, path] of Object.entries(mapped)) keep(name, at(line, path));
      else {
        const written = at(line, "outcomes");
        if (isObject(written)) for (const [name, v] of Object.entries(written)) keep(name, v);
      }
      const version = at(line, record?.version ?? "definition.version");
      const when = at(line, "at");
      const id = (line as Record<string, unknown>).id;
      out.runs.push({
        line: i + 1,
        id: typeof id === "string" ? id : null,
        ...(typeof when === "string" ? { at: when } : {}),
        version: typeof version === "string" ? version : null,
        values,
        answers,
        recorded,
        lacks,
      });
      return;
    }
    if (kind === "ruling") {
      const l = line as Record<string, unknown>;
      const text = (path: string): string | null => {
        const v = at(l, path);
        return typeof v === "string" ? v : null;
      };
      const when = text(record?.ruling?.at ?? "at");
      const named = typeof l.decision === "string" ? l.decision : (def.rulings?.decision ?? (persons.length === 1 ? persons[0].name : null));
      out.rulings.push({
        line: i + 1,
        run: typeof l[key] === "string" ? (l[key] as string) : null,
        decision: typeof named === "string" ? named : null,
        outcome: text(record?.ruling?.outcome ?? "outcome"),
        by: text(record?.ruling?.by ?? "decided_by"),
        words: text(record?.ruling?.words ?? "words"),
        ...(when ? { at: when } : {}),
        standing: true,
      });
      return;
    }
    if (kind === "ruling_withdrawn") {
      out.withdrawals += 1;
      const l = line as Record<string, unknown>;
      const run = typeof l[key] === "string" ? (l[key] as string) : null;
      const stamp = typeof l.withdrawn_ruling_at === "string" ? l.withdrawn_ruling_at : null;
      const decision = typeof l.decision === "string" ? l.decision : null;
      // The ruling it names by its time, else the last one given on that run (for that decision, when it names one).
      const candidates = out.rulings.filter(
        (r) => r.standing && r.run === run && (stamp === null || r.at === stamp) && (decision === null || r.decision === decision),
      );
      const target = candidates[candidates.length - 1];
      if (target) target.standing = false;
      else out.unmatched_withdrawals.push(i + 1);
      return;
    }
    out.other += 1;
  });

  // A ruling that cannot stand is said to, with why. It is never counted and never given to a run.
  const runIds = new Set(out.runs.map((r) => r.id).filter((id): id is string => id !== null));
  for (const r of out.rulings) {
    const person = r.decision ? byName.get(r.decision) : undefined;
    const why =
      r.run === null
        ? `it names no run (no "${key}")`
        : !runIds.has(r.run)
          ? `the ledger holds no run "${r.run}"`
          : !person || person.logic?.kind !== "person"
            ? r.decision
              ? `"${r.decision}" is not a person's decision of the model`
              : "it does not say which person's decision it rules, and the model has more than one"
            : r.outcome === null
              ? "it rules nothing (no outcome)"
              : !outcomesOf(person).includes(r.outcome)
                ? `it rules "${r.outcome}", which is not an outcome of "${person.name}"`
                : !r.by?.trim()
                  ? "it does not say who ruled"
                  : undefined;
    if (why) r.unusable = why;
  }
  return out;
}

export interface LedgerReplayOutcome {
  recorded: string;
  replayed: string | null;
  status: DmdResultStatus;
  /** The rule that decided it in the replay. */
  rule: number | null;
  same: boolean;
}

/** A ruling in force on a run, and how it compares with what the replay gives for the decisions it answered. */
export interface LedgerRulingInForce {
  decision: string;
  outcome: string;
  by: string;
  words: string | null;
  at?: string;
  line: number;
  against: Record<string, "same" | "different">;
}

export interface LedgerReplayRun {
  id: string | null;
  line: number;
  at?: string;
  version: string | null;
  /** Whether the run recorded the version the document has now. Null when it recorded none. */
  version_matches: boolean | null;
  replayable: boolean;
  lacks: string[];
  /** The replayed run, with its rule trace. Null when the line lacks what a table reads. */
  run: DecisionRun | null;
  /** Each recorded outcome beside what the replay gives. */
  outcomes: Record<string, LedgerReplayOutcome>;
  /** Every recorded outcome replays as recorded. Null when not replayable, or when the line recorded none. */
  same: boolean | null;
  /** The rulings in force on this run: one per person's decision, the last that still stands. */
  rulings: LedgerRulingInForce[];
}

export interface LedgerReplay {
  definition: { namespace: string; name: string; version: string | null };
  bars: Record<string, number>;
  lines: number;
  counts: { runs: number; rulings: number; withdrawals: number; other: number };
  replayed: number;
  same: number;
  different: number;
  not_replayable: number;
  version_differs: number;
  rulings: {
    /** Rulings in force: one per run and person's decision, the last that still stands and can stand. */
    in_force: number;
    withdrawn: number;
    /** Rulings that cannot stand, each with why. Never counted. */
    unusable: { line: number; why: string }[];
    /** Withdrawals that found no ruling, by line. */
    unmatched_withdrawals: number[];
    bar_after: number | null;
    /** The person's decision whose rulings are counted against `bar_after`: `rulings.decision`, or every one. */
    counted: string | null;
    /** Whether `bar_after` of them stand. Null when the document sets no count. */
    reached: boolean | null;
    /** Per decision a ruling answered: how many rulings said the same as the replay gives, and how many differed. */
    against: Record<string, { same: number; different: number }>;
  };
  runs: LedgerReplayRun[];
}

/** What a decision gives as one text: its outcome, a choice's option, what a collecting table collected. */
function valueOf(r: DmdDecisionResult | undefined): string | null {
  if (!r) return null;
  if (r.kind === "question") return r.answer?.type === "choice" ? r.answer.choice : null;
  if (r.outcomes) return r.outcomes.join(", ");
  return r.outcome ?? null;
}

/** Replay every recorded run. `bars` tries other bar values on the same answers. */
export function replayLedger(
  model: DecisionModelDefinition,
  lines: readonly unknown[],
  opts: { bars?: Record<string, number> | null } = {},
): LedgerReplay {
  const def = safeModel(model);
  const reading = readLedger(def, lines);
  const current = typeof def.settings.version === "string" && def.settings.version.trim() ? def.settings.version : null;
  const requiresOf = new Map(decisionsInOrder(def).map((d) => [d.name, d.requires ?? []]));

  // In force: per run and person's decision, the last ruling that still stands and can stand.
  const inForce = new Map<string, Map<string, LedgerRuling>>();
  for (const r of reading.rulings) {
    if (!r.standing || r.unusable || !r.run || !r.decision) continue;
    if (!inForce.has(r.run)) inForce.set(r.run, new Map());
    inForce.get(r.run)!.set(r.decision, r);
  }

  const against = new Map<string, { same: number; different: number }>();
  const runs: LedgerReplayRun[] = reading.runs.map((recorded) => {
    const held = [...(recorded.id ? (inForce.get(recorded.id)?.values() ?? []) : [])];
    const base = {
      id: recorded.id,
      line: recorded.line,
      ...(recorded.at ? { at: recorded.at } : {}),
      version: recorded.version,
      version_matches: recorded.version === null ? null : recorded.version === current,
      lacks: recorded.lacks,
    };
    const inForceOf = (how: (r: LedgerRuling) => Record<string, "same" | "different">): LedgerRulingInForce[] =>
      held.map((r) => ({
        decision: r.decision as string,
        outcome: r.outcome as string,
        by: r.by as string,
        words: r.words,
        ...(r.at ? { at: r.at } : {}),
        line: r.line,
        against: how(r),
      }));
    if (recorded.lacks.length) {
      return { ...base, replayable: false, run: null, outcomes: {}, same: null, rulings: inForceOf(() => ({})) };
    }

    const given: Record<string, DmdRuling> = Object.fromEntries(
      held.map((r) => [r.decision as string, { outcome: r.outcome as string, by: r.by as string, words: r.words, ...(r.at ? { at: r.at } : {}) }]),
    );
    const run = evaluateDecisions(def, { values: recorded.values, answers: recorded.answers, rulings: given, bars: opts.bars });
    const resultOf = new Map(run.results.map((r) => [r.decision, r]));
    const outcomes: Record<string, LedgerReplayOutcome> = Object.fromEntries(
      Object.entries(recorded.recorded).map(([name, was]) => {
        const r = resultOf.get(name);
        const replayed = valueOf(r);
        return [name, { recorded: was, replayed, status: r?.status ?? "error", rule: r?.rule ?? null, same: replayed === was }];
      }),
    );
    const compared = Object.values(outcomes);
    const rulings = inForceOf((ruling) => {
      const how = new Map<string, "same" | "different">();
      for (const name of requiresOf.get(ruling.decision as string) ?? []) {
        const value = valueOf(resultOf.get(name));
        if (value === null) continue;
        const verdict = value === ruling.outcome ? "same" : "different";
        how.set(name, verdict);
        const tally = against.get(name) ?? { same: 0, different: 0 };
        tally[verdict] += 1;
        against.set(name, tally);
      }
      return Object.fromEntries(how);
    });
    return { ...base, replayable: true, run, outcomes, same: compared.length ? compared.every((o) => o.same) : null, rulings };
  });

  const barAfter = Number.isInteger(def.rulings?.bar_after) ? (def.rulings!.bar_after as number) : null;
  const counted = typeof def.rulings?.decision === "string" ? def.rulings.decision : null;
  let inForceCount = 0;
  for (const perRun of inForce.values()) for (const decision of perRun.keys()) if (counted === null || decision === counted) inForceCount += 1;
  const replayed = runs.filter((r) => r.replayable);
  return {
    definition: {
      namespace: typeof def.settings.namespace === "string" ? def.settings.namespace : "",
      name: typeof def.settings.name === "string" ? def.settings.name : "",
      version: current,
    },
    bars: evaluateDecisions(def, { bars: opts.bars }).bars,
    lines: reading.lines,
    counts: { runs: reading.runs.length, rulings: reading.rulings.length, withdrawals: reading.withdrawals, other: reading.other },
    replayed: replayed.length,
    same: replayed.filter((r) => r.same === true).length,
    different: replayed.filter((r) => r.same === false).length,
    not_replayable: runs.length - replayed.length,
    version_differs: runs.filter((r) => r.version_matches === false).length,
    rulings: {
      in_force: inForceCount,
      withdrawn: reading.rulings.filter((r) => !r.standing).length,
      unusable: reading.rulings.filter((r) => r.standing && r.unusable).map((r) => ({ line: r.line, why: r.unusable as string })),
      unmatched_withdrawals: reading.unmatched_withdrawals,
      bar_after: barAfter,
      counted,
      reached: barAfter === null ? null : inForceCount >= barAfter,
      against: Object.fromEntries(against),
    },
    runs,
  };
}

/** A replay as lines a person can read: the counts, then one line per run. */
export function formatLedgerReplay(replay: LedgerReplay): string {
  const c = replay.counts;
  const lines: string[] = [
    `${replay.definition.name || "decision model"} ${replay.definition.version ?? "(no version)"}: ${replay.lines} line(s), of which ${c.runs} run(s), ${c.rulings} ruling(s), ${c.withdrawals} withdrawal(s)${c.other ? `, ${c.other} other` : ""}`,
    `${replay.replayed} of ${c.runs} run(s) replayed: ${replay.same} give what was recorded, ${replay.different} differ${replay.not_replayable ? `, ${replay.not_replayable} cannot be replayed` : ""}`,
  ];
  const bars = Object.entries(replay.bars);
  if (bars.length) lines.push(`bars: ${bars.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (replay.version_differs) {
    lines.push(`${replay.version_differs} run(s) recorded another version than the document's ${replay.definition.version ?? "(none)"}: their outcomes are compared, and the rules they ran may not be these`);
  }
  for (const r of replay.runs) {
    const head = `${r.id ?? `line ${r.line}`}`;
    if (!r.replayable) {
      lines.push(`${head}: cannot be replayed, the line lacks ${r.lacks.join("; ")}`);
      continue;
    }
    const parts = Object.entries(r.outcomes).map(
      ([name, o]) => `${name} ${o.replayed ?? `no outcome (${o.status})`}${o.rule ? ` by rule ${o.rule}` : ""}, recorded ${o.recorded}: ${o.same ? "same" : "DIFFERENT"}`,
    );
    const many = r.rulings.length > 1;
    const ruled = r.rulings.length
      ? r.rulings
          .map((g) => {
            const how = Object.entries(g.against).map(([k, v]) => `${v === "same" ? "as" : "against"} ${k}`).join(", ");
            return ` · ${many ? `${g.decision} ` : ""}ruled ${g.outcome} by ${g.by}${how ? ` (${how})` : ""}`;
          })
          .join("")
      : " · no ruling";
    const version = r.version_matches === false ? ` · recorded under ${r.version}` : "";
    lines.push(`${head}: ${parts.join("; ") || "no outcome recorded"}${ruled}${version}`);
  }
  const g = replay.rulings;
  const tally = Object.entries(g.against).map(([k, v]) => `${k}: ${v.same} the same, ${v.different} different`).join("; ");
  lines.push(
    `rulings in force${g.counted ? ` on ${g.counted}` : ""}: ${g.in_force}${g.withdrawn ? ` (${g.withdrawn} withdrawn)` : ""}${g.bar_after !== null ? `, of the ${g.bar_after} after which a person may set a bar: ${g.reached ? "reached" : "not reached"}` : ""}${tally ? ` · compared with what the replay gives, ${tally}` : ""}`,
  );
  for (const u of g.unusable) lines.push(`the ruling on line ${u.line} is not counted: ${u.why}`);
  if (g.unmatched_withdrawals.length) lines.push(`the withdrawal(s) on line ${g.unmatched_withdrawals.join(", ")} found no ruling to withdraw`);
  return lines.join("\n");
}
