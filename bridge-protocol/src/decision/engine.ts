/**
 * `toEngineRequest` — the request a decision model makes of its engine (Spec 85).
 *
 * Built from the document, so the drawing and the call cannot disagree: `state`
 * holds what the questions of one group require, keyed by name, and `questions`
 * holds those questions, keyed by name, each with its type, its instructions and
 * its criteria. A table is never sent (code decides it) and a person's decision
 * is never sent (a person rules it).
 *
 * One request is one group: its questions see the same state and are answered
 * independently. A question that needs another's answer is in a later request,
 * and that answer arrives in `values` like any input.
 *
 * Nothing is sent from here. The caller sends it, or reads it.
 *
 * Pure — no I/O.
 */
import {
  bindingOf,
  decisionOf,
  requestGroups,
  type DecisionModelDefinition,
  type DmdQuestionType,
} from "./definition.js";

export interface EngineQuestion {
  type: DmdQuestionType;
  instructions: string;
  /** A noul's `{ true, false }`, a choice's options in the order sent, a score's levels. */
  criteria?: Record<string, string> | string[];
}

export interface EngineRequest {
  state: Record<string, unknown>;
  model?: string;
  questions: Record<string, EngineQuestion>;
}

export interface EngineRequestOptions {
  /** Which request to build. The model's first when omitted. */
  group?: string;
  /** The provider's model, in place of the document's binding. */
  model?: string;
  /** How far to turn the options of each question that rotates: the count of runs before this one. */
  rotation?: number;
  /** A recorded order per question, to build a past request again. */
  optionOrder?: Record<string, string[]>;
}

export function toEngineRequest(
  def: DecisionModelDefinition,
  values: Record<string, unknown> = {},
  opts: EngineRequestOptions = {},
): EngineRequest {
  const groups = requestGroups(def);
  if (!groups.length) throw new Error(`'${def.settings?.name ?? ""}' asks its engine nothing: it has no question.`);
  const group = opts.group === undefined ? groups[0] : groups.find((g) => g.name === opts.group);
  if (!group) throw new Error(`No request '${opts.group}'. Requests: ${groups.map((g) => g.name).join(", ")}.`);
  if (!group.questions.length) throw new Error(`The group '${group.name}' holds no question.`);

  const needed = new Set<string>();
  for (const q of group.questions) for (const r of decisionOf(def, q)?.requires ?? []) needed.add(r);
  // Inputs first, in the order the document writes them, then the decisions a question waits on.
  const order = [
    ...(def.inputs ?? []).map((i) => i?.name),
    ...(def.decisions ?? []).map((d) => d?.name),
  ].filter((n): n is string => typeof n === "string" && needed.has(n));
  const state: Record<string, unknown> = {};
  const absent: string[] = [];
  for (const name of order) {
    if (values[name] === undefined || values[name] === null) absent.push(name);
    else state[name] = values[name];
  }
  if (absent.length) {
    throw new Error(`The request '${group.name}' needs a value for: ${absent.join(", ")}. A missing value is not sent as an empty one.`);
  }

  const questions: Record<string, EngineQuestion> = {};
  for (const name of group.questions) {
    const logic = decisionOf(def, name)?.logic;
    if (logic?.kind !== "question") continue;
    const question: EngineQuestion = { type: logic.type, instructions: logic.instructions };
    if (logic.type === "noul") {
      const criteria: Record<string, string> = {};
      if (typeof logic.criteria?.true === "string") criteria.true = logic.criteria.true;
      if (typeof logic.criteria?.false === "string") criteria.false = logic.criteria.false;
      if (Object.keys(criteria).length) question.criteria = criteria;
    } else if (logic.type === "choice") {
      const options = logic.options ?? {};
      const keys = Object.keys(options);
      let sent = keys;
      const recorded = opts.optionOrder?.[name];
      if (recorded) {
        if (recorded.length !== keys.length || recorded.some((k) => !keys.includes(k)) || new Set(recorded).size !== keys.length) {
          throw new Error(`The order given for '${name}' (${recorded.join(", ")}) is not its options (${keys.join(", ")}) in some order.`);
        }
        sent = recorded;
      } else if (logic.rotate && keys.length && Number.isInteger(opts.rotation)) {
        const k = (((opts.rotation as number) % keys.length) + keys.length) % keys.length;
        sent = [...keys.slice(k), ...keys.slice(0, k)];
      }
      question.criteria = Object.fromEntries(sent.map((k) => [k, options[k]]));
    } else {
      question.criteria = [...(logic.levels ?? [])];
    }
    questions[name] = question;
  }

  const model = opts.model ?? bindingOf(def).model;
  return model ? { state, model, questions } : { state, questions };
}
