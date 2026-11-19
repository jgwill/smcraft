/**
 * A decision model's ledger, read and replayed (Spec 85).
 *
 * A ledger is the lines a caller kept: each run (`kind: "decision"`), each
 * ruling on a run (`kind: "ruling"`) and each withdrawal of a ruling
 * (`kind: "ruling_withdrawn"`). `replayLedger` runs every recorded run through
 * the document again, from the answers the line holds, and says for each
 * whether the tables give what was recorded. No engine is asked.
 *
 * Where a line does not hold something the replay needs, the run is reported
 * as not replayable, with the field it lacks. Nothing is assumed in its place:
 * a key that is absent is a ledger that never kept it, while a `null` is an
 * engine that never answered, and the two are not the same finding.
 *
 * A ruling is compared with what it answered (the table's outcome, the
 * engine's choice), which is the count a person reads before moving a bar.
 * The loom never moves one.
 *
 * Pure — no I/O. The caller reads the file and hands over its parsed lines.
 */
import {
  decisionOf,
  decisionsInOrder,
  type DecisionModelDefinition,
  type DmdQuestionLogic,
} from "./definition.js";
import { evaluateDecisions, type DecisionRun, type DmdResultStatus, type DmdRuling } from "./evaluate.js";

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

/** The value at a dot-separated path, `undefined` when any step is absent. */
function at(line: unknown, path: string): unknown {
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
  /** The outcomes the line recorded, by decision. */
  recorded: Record<string, string>;
  /** What a replay needs and the line never kept, each with where it was looked for. */
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
}

export interface LedgerReading {
  lines: number;
  runs: LedgerRun[];
  rulings: LedgerRuling[];
  withdrawals: number;
  /** Lines that are none of the three. */
  other: number;
}

const ANSWER_PARTS: Record<DmdQuestionLogic["type"], string[]> = {
  noul: ["noul"],
  choice: ["choice", "confidence", "probabilities"],
  score: ["score", "confidence", "probabilities"],
};

export function readLedger(def: DecisionModelDefinition, lines: readonly unknown[]): LedgerReading {
  const record = def.rulings?.record;
  const key = def.rulings?.key || "decision_id";
  const decisions = decisionsInOrder(def);
  const questions = decisions.filter((d) => d.logic?.kind === "question");
  const persons = decisions.filter((d) => d.logic?.kind === "person");
  // Only what a table reads is needed to replay a table: a question's answer, and an input a table requires.
  const tableInputs = new Set<string>();
  const inputNames = new Set((def.inputs ?? []).map((i) => i?.name));
  for (const d of decisions) {
    if (d.logic?.kind === "table") for (const r of d.requires ?? []) if (inputNames.has(r)) tableInputs.add(r);
  }

  const out: LedgerReading = { lines: lines.length, runs: [], rulings: [], withdrawals: 0, other: 0 };
  lines.forEach((line, i) => {
    const kind = isObject(line) ? line.kind : undefined;
    if (kind === "decision") {
      const lacks: string[] = [];
      const values: Record<string, unknown> = {};
      for (const input of def.inputs ?? []) {
        if (!input?.name) continue;
        const path = record?.values?.[input.name] ?? `values.${input.name}`;
        const v = at(line, path);
        if (v !== undefined) values[input.name] = v;
        else if (tableInputs.has(input.name)) lacks.push(`the value of ${input.name} (${path})`);
      }
      const answers: Record<string, unknown> = {};
      for (const q of questions) {
        const logic = q.logic as DmdQuestionLogic;
        const map = record?.answers?.[q.name];
        if (!map) {
          const v = at(line, `answers.${q.name}`);
          if (v === undefined) lacks.push(`the answer of ${q.name} (answers.${q.name})`);
          else answers[q.name] = v;
          continue;
        }
        const parts = (ANSWER_PARTS[logic.type] ?? []).map((part) => ({ part, path: map[part], value: map[part] ? at(line, map[part]) : undefined }));
        const absent = parts.filter((p) => p.value === undefined);
        if (absent.length) {
          lacks.push(`the answer of ${q.name} (${absent.map((p) => p.path ?? `no path for ${p.part}`).join(", ")})`);
          continue;
        }
        // Every part null: the engine was asked and gave nothing. That is a recorded fact, and it replays as one.
        answers[q.name] = parts.every((p) => p.value === null) ? null : Object.fromEntries(parts.map((p) => [p.part, p.value]));
      }
      const recorded: Record<string, string> = {};
      const mapped = record?.outcomes;
      if (mapped) {
        for (const [name, path] of Object.entries(mapped)) {
          const v = at(line, path);
          if (typeof v === "string") recorded[name] = v;
        }
      } else {
        const own = at(line, "outcomes");
        if (isObject(own)) for (const [name, v] of Object.entries(own)) if (typeof v === "string") recorded[name] = v;
      }
      const version = at(line, record?.version ?? "definition.version");
      const when = at(line, "at");
      out.runs.push({
        line: i + 1,
        id: typeof (line as Record<string, unknown>).id === "string" ? ((line as Record<string, unknown>).id as string) : null,
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
        decision: named,
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
      // The ruling it names by its time, else the last one given on that run.
      const candidates = out.rulings.filter((r) => r.standing && r.run === run && (stamp === null || r.at === stamp));
      const target = candidates[candidates.length - 1];
      if (target) target.standing = false;
      return;
    }
    out.other += 1;
  });
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

export interface LedgerReplayRun {
  id: string | null;
  line: number;
  at?: string;
  version: string | null;
  /** Whether the run recorded the version the document has now. Null when it recorded none. */
  version_matches: boolean | null;
  replayable: boolean;
  lacks: string[];
  /** The replayed run, with its rule trace. Null when the line lacks what a replay needs. */
  run: DecisionRun | null;
  /** Each recorded outcome beside what the replay gives. */
  outcomes: Record<string, LedgerReplayOutcome>;
  /** Every recorded outcome replays as recorded. Null when not replayable, or when the line recorded none. */
  same: boolean | null;
  /** The ruling in force on this run, and how it compares with what it answered. */
  ruling?: {
    decision: string | null;
    outcome: string | null;
    by: string | null;
    words: string | null;
    at?: string;
    line: number;
    against: Record<string, "same" | "different">;
  };
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
    /** One per run: the last ruling on it that still stands. */
    in_force: number;
    withdrawn: number;
    bar_after: number | null;
    /** Whether `bar_after` rulings stand. Null when the document sets no count. */
    reached: boolean | null;
    /** Per decision a ruling answered: how many rulings said the same, and how many differed. */
    against: Record<string, { same: number; different: number }>;
  };
  runs: LedgerReplayRun[];
}

/** Replay every recorded run. `bars` tries other bar values on the same answers. */
export function replayLedger(
  def: DecisionModelDefinition,
  lines: readonly unknown[],
  opts: { bars?: Record<string, number> } = {},
): LedgerReplay {
  const reading = readLedger(def, lines);
  const current = typeof def.settings?.version === "string" && def.settings.version.trim() ? def.settings.version : null;
  const inForce = new Map<string, LedgerRuling>();
  for (const r of reading.rulings) if (r.standing && r.run) inForce.set(r.run, r);

  const against: Record<string, { same: number; different: number }> = {};
  const runs: LedgerReplayRun[] = reading.runs.map((recorded) => {
    const ruling = recorded.id ? inForce.get(recorded.id) : undefined;
    const base = {
      id: recorded.id,
      line: recorded.line,
      ...(recorded.at ? { at: recorded.at } : {}),
      version: recorded.version,
      version_matches: recorded.version === null ? null : recorded.version === current,
      lacks: recorded.lacks,
    };
    const rulingOf = (how: Record<string, "same" | "different">): LedgerReplayRun["ruling"] =>
      ruling
        ? { decision: ruling.decision, outcome: ruling.outcome, by: ruling.by, words: ruling.words, ...(ruling.at ? { at: ruling.at } : {}), line: ruling.line, against: how }
        : undefined;
    if (recorded.lacks.length) {
      const held = rulingOf({});
      return { ...base, replayable: false, run: null, outcomes: {}, same: null, ...(held ? { ruling: held } : {}) };
    }

    const given: Record<string, DmdRuling> = {};
    if (ruling?.decision && ruling.outcome && ruling.by) {
      given[ruling.decision] = { outcome: ruling.outcome, by: ruling.by, words: ruling.words, ...(ruling.at ? { at: ruling.at } : {}) };
    }
    const run = evaluateDecisions(def, { values: recorded.values, answers: recorded.answers, rulings: given, bars: opts.bars });
    const outcomes: Record<string, LedgerReplayOutcome> = {};
    for (const [name, was] of Object.entries(recorded.recorded)) {
      const r = run.results.find((x) => x.decision === name);
      const replayed = r?.kind === "question" ? (r.answer?.type === "choice" ? r.answer.choice : null) : (r?.outcome ?? null);
      outcomes[name] = { recorded: was, replayed, status: r?.status ?? "error", rule: r?.rule ?? null, same: replayed === was };
    }
    const compared = Object.values(outcomes);

    const how: Record<string, "same" | "different"> = {};
    if (ruling?.decision && ruling.outcome) {
      for (const name of decisionOf(def, ruling.decision)?.requires ?? []) {
        const r = run.results.find((x) => x.decision === name);
        if (!r) continue;
        const value = r.kind === "question" ? (r.answer?.type === "choice" ? r.answer.choice : undefined) : r.outcome;
        if (value === undefined) continue;
        how[name] = value === ruling.outcome ? "same" : "different";
        against[name] ??= { same: 0, different: 0 };
        against[name][how[name]] += 1;
      }
    }
    const held = rulingOf(how);
    return {
      ...base,
      replayable: true,
      run,
      outcomes,
      same: compared.length ? compared.every((o) => o.same) : null,
      ...(held ? { ruling: held } : {}),
    };
  });

  const barAfter = Number.isInteger(def.rulings?.bar_after) ? (def.rulings!.bar_after as number) : null;
  const replayed = runs.filter((r) => r.replayable);
  return {
    definition: { namespace: def.settings?.namespace ?? "", name: def.settings?.name ?? "", version: current },
    bars: replayed[0]?.run?.bars ?? evaluateDecisions(def, { bars: opts.bars }).bars,
    lines: reading.lines,
    counts: { runs: reading.runs.length, rulings: reading.rulings.length, withdrawals: reading.withdrawals, other: reading.other },
    replayed: replayed.length,
    same: replayed.filter((r) => r.same === true).length,
    different: replayed.filter((r) => r.same === false).length,
    not_replayable: runs.length - replayed.length,
    version_differs: runs.filter((r) => r.version_matches === false).length,
    rulings: {
      in_force: inForce.size,
      withdrawn: reading.rulings.filter((r) => !r.standing).length,
      bar_after: barAfter,
      reached: barAfter === null ? null : inForce.size >= barAfter,
      against,
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
    const ruled = r.ruling
      ? ` · ruled ${r.ruling.outcome ?? "?"} by ${r.ruling.by ?? "?"}${Object.keys(r.ruling.against).length ? ` (${Object.entries(r.ruling.against).map(([k, v]) => `${v === "same" ? "as" : "against"} ${k}`).join(", ")})` : ""}`
      : " · no ruling";
    const version = r.version_matches === false ? ` · recorded under ${r.version}` : "";
    lines.push(`${head}: ${parts.join("; ") || "no outcome recorded"}${ruled}${version}`);
  }
  const g = replay.rulings;
  const tally = Object.entries(g.against).map(([k, v]) => `${k}: ${v.same} the same, ${v.different} different`).join("; ");
  lines.push(
    `rulings in force: ${g.in_force}${g.withdrawn ? ` (${g.withdrawn} withdrawn)` : ""}${g.bar_after !== null ? `, of the ${g.bar_after} after which a person may set a bar: ${g.reached ? "reached" : "not reached"}` : ""}${tally ? ` · ${tally}` : ""}`,
  );
  return lines.join("\n");
}
