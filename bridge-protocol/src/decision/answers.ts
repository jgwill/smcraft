/**
 * Typed answers (Spec 85) — what an engine gives back for each question type,
 * and the fields a rule may read from it.
 *
 * The three are different things and stay different:
 *
 * - a `noul` is the probability that the proposition is true. 0.5 is "cannot
 *   tell", not "half as much". It has no confidence of its own.
 * - a `choice` is a distribution over its options, the option the engine
 *   picked, and how peaked the distribution is.
 * - a `score` is a position on ordered levels, which may fall between two.
 *
 * The answer is read in the engine's own shape (`{ type, noul }`,
 * `{ type, choice, confidence, probabilities }`, `{ type, score, confidence,
 * probabilities }`), so a recorded response replays as it was received. The
 * checks are those of the Factory's decider (examples/decision-gate/lane-check
 * `validateAnswer`): an answer that breaks its contract is `invalid`, and no
 * number is read from it.
 *
 * Pure — no I/O.
 */
import { DMD_LIMITS, type DmdQuestionLogic, type DmdQuestionType } from "./definition.js";
import type { RuleType } from "./expression.js";

export interface NoulAnswer {
  type: "noul";
  /** The probability that the proposition is true, 0 to 1. */
  yes: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  /** How peaked the distribution is, 0 to 1, as the engine reports it. */
  confidence: number;
  probabilities: Record<string, number>;
  /** The highest probability. */
  top: number;
  /** The highest probability minus the next one. */
  margin: number;
}

export interface ScoreAnswer {
  type: "score";
  /** The position on the levels, 0 for the first. It may fall between two levels. */
  score: number;
  confidence: number;
  /** Keyed by level index, as text: "0", "1", … */
  probabilities: Record<string, number>;
}

export type TypedAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type AnswerReading =
  | { status: "answered"; answer: TypedAnswer }
  | { status: "missing" }
  | { status: "invalid"; failures: string[] };

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const isUnit = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
const round = (x: number): number => Number(x.toFixed(6));

/**
 * Read one recorded answer against the question it answers. `undefined` and
 * `null` are a question that was not answered; anything else is checked.
 */
export function readAnswer(question: DmdQuestionLogic, raw: unknown): AnswerReading {
  if (raw === undefined || raw === null) return { status: "missing" };
  if (!isObject(raw)) return { status: "invalid", failures: ["the answer is not an object"] };
  const failures: string[] = [];
  if (raw.type !== undefined && raw.type !== question.type) {
    return { status: "invalid", failures: [`asked a ${question.type}, answered a ${String(raw.type)}`] };
  }

  if (question.type === "noul") {
    const yes = raw.noul ?? raw.yes;
    if (yes === undefined || yes === null) return { status: "missing" };
    if (!isUnit(yes)) return { status: "invalid", failures: [`a noul is a probability within 0 and 1, got ${JSON.stringify(yes)}`] };
    return { status: "answered", answer: { type: "noul", yes } };
  }

  const keys =
    question.type === "choice"
      ? Object.keys(isObject(question.options) ? question.options : {})
      : (Array.isArray(question.levels) ? question.levels : []).map((_, i) => String(i));
  if (!isUnit(raw.confidence)) failures.push(`confidence must be within 0 and 1, got ${JSON.stringify(raw.confidence)}`);
  const probabilities = raw.probabilities;
  if (!isObject(probabilities)) {
    failures.push("no probabilities");
  } else {
    const missing = keys.filter((k) => !Object.hasOwn(probabilities, k));
    // Sorted, so the same invalid answer reads the same whatever order its keys arrived in.
    const extra = Object.keys(probabilities).filter((k) => !keys.includes(k)).sort();
    if (missing.length) failures.push(`probabilities must cover what was declared; missing ${missing.join(", ")}`);
    if (extra.length) failures.push(`probabilities name what was not declared: ${extra.join(", ")}`);
    const bad = keys.filter((k) => Object.hasOwn(probabilities, k) && !isUnit(probabilities[k]));
    if (bad.length) failures.push(`probabilities must be within 0 and 1: ${bad.join(", ")}`);
    const sum = keys.reduce((acc, k) => acc + (isUnit(probabilities[k]) ? (probabilities[k] as number) : 0), 0);
    if (!missing.length && !bad.length && Math.abs(sum - 1) > DMD_LIMITS.SUM_TOLERANCE) {
      failures.push(`probabilities sum to ${Number(sum.toFixed(4))}, not 1 within ${DMD_LIMITS.SUM_TOLERANCE}`);
    }
  }

  if (question.type === "choice") {
    if (typeof raw.choice !== "string" || !keys.includes(raw.choice)) failures.push(`chose ${JSON.stringify(raw.choice)}, which is not a declared option`);
    if (failures.length) return { status: "invalid", failures };
    const p = probabilities as Record<string, number>;
    // In the order the question declares its options, whatever order the answer came in.
    const ordered = Object.fromEntries(keys.map((k) => [k, p[k]]));
    const sorted = keys.map((k) => p[k]).sort((a, b) => b - a);
    return {
      status: "answered",
      answer: {
        type: "choice",
        choice: raw.choice as string,
        confidence: raw.confidence as number,
        probabilities: ordered,
        top: sorted[0],
        margin: round(sorted[0] - (sorted[1] ?? 0)),
      },
    };
  }

  const score = raw.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > keys.length - 1) {
    failures.push(`a score is a position within 0 and ${keys.length - 1}, got ${JSON.stringify(score)}`);
  }
  if (failures.length) return { status: "invalid", failures };
  const p = probabilities as Record<string, number>;
  return {
    status: "answered",
    answer: { type: "score", score: score as number, confidence: raw.confidence as number, probabilities: Object.fromEntries(keys.map((k) => [k, p[k]])) },
  };
}

/** The fields a rule may read from an answer of each type, and what each is. */
export const ANSWER_FIELDS: Record<DmdQuestionType, Record<string, RuleType | "distribution">> = {
  noul: { yes: "number" },
  choice: { choice: "string", confidence: "number", probabilities: "distribution", top: "number", margin: "number" },
  score: { score: "number", confidence: "number", probabilities: "distribution" },
};

/** What a rule says to read a question's answer, when it named the question alone. */
export function answerFieldsHint(type: DmdQuestionType): string {
  return Object.keys(ANSWER_FIELDS[type])
    .map((f) => `.${f}`)
    .join(", ");
}
