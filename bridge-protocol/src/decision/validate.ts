/**
 * DMDF validation — rules D001–D007 and D009–D022 (Spec 85). D008 is the
 * system's: whether an event or an entity a model names exists is answered by
 * `checkSystem`.
 *
 * The document's own shape only, read defensively: it usually arrives from an
 * agent or from disk. An issue is an error unless it says `severity: "warning"`.
 * A warning is a document the loom reads and draws, and does less with: a table
 * written in words only is drawn and not run.
 *
 * Pure — no I/O.
 */
import type { ErdValidationError } from "../erd/validate.js";
import { ANSWER_FIELDS, answerFieldsHint } from "./answers.js";
import {
  DMD_HIT_POLICIES,
  DMD_INPUT_TYPES,
  DMD_KNOWLEDGE_KINDS,
  DMD_LIMITS,
  DMD_LOGIC_KINDS,
  DMD_QUESTION_TYPES,
  eventOf,
  outcomesOf,
  questionsBehind,
  type DecisionModelDefinition,
  type DmdDecision,
  type DmdQuestionLogic,
  type DmdTableLogic,
} from "./definition.js";
import { RULE_FUNCTIONS, checkRule, parseRule, type RuleEnv, type RuleType } from "./expression.js";

export interface DmdValidationError extends ErdValidationError {
  /** Absent: an error. */
  severity?: "warning";
}

const RESERVED = new Set<string>(["and", "or", "not", "in", "true", "false", "otherwise", ...RULE_FUNCTIONS]);
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const blank = (x: unknown): boolean => typeof x !== "string" || !x.trim();

/** The plain names a text puts in backticks: `` `action` `` → `action`. Anything else in backticks is left alone. */
export function backtickedNames(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`]+)`/g)) if (VARIABLE_NAME.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Every text of a question that reaches the engine. */
function questionTexts(logic: DmdQuestionLogic): string[] {
  return [
    logic.instructions,
    logic.criteria?.true,
    logic.criteria?.false,
    ...Object.values(logic.options ?? {}),
    ...(Array.isArray(logic.levels) ? logic.levels : []),
  ].filter((t): t is string => typeof t === "string");
}

/** What a table's rules may read, and as what. Shared with the evaluator's own refusals. */
export function ruleEnvOf(def: DecisionModelDefinition, table: DmdDecision): RuleEnv {
  const inputs = new Map((def.inputs ?? []).filter((i) => i?.name).map((i) => [i.name, i]));
  const decisions = new Map((def.decisions ?? []).filter((d) => d?.name).map((d) => [d.name, d]));
  const bars = new Set((def.bars ?? []).filter((b) => b?.name).map((b) => b.name));
  const requires = new Set(table.requires ?? []);
  const known = (name: string): string | undefined => {
    if (!inputs.has(name) && !decisions.has(name)) return `reads \`${name}\`, which is not an input, a bar or a decision of the model`;
    if (!requires.has(name)) return `reads \`${name}\`, which it does not require: a rule reads only what the drawing shows arriving`;
    return undefined;
  };
  return {
    typeOf(name, path): RuleType | { error: string } {
      const text = [name, ...path].join(".");
      if (bars.has(name)) return path.length ? { error: `\`${name}\` is a bar, a number: \`${text}\` reads nothing` } : "number";
      const why = known(name);
      if (why) return { error: why };
      const input = inputs.get(name);
      if (input) {
        if (path.length) return { error: `\`${name}\` is an input: \`${text}\` reads nothing` };
        return DMD_INPUT_TYPES.includes(input.type as never) ? (input.type as RuleType) : "any";
      }
      const d = decisions.get(name)!;
      const logic = d.logic;
      if (logic?.kind === "question") {
        const fields = ANSWER_FIELDS[logic.type];
        // A question with no type the loom knows is D005's finding; what a rule reads from it is not a second one.
        if (!fields) return "any";
        if (!path.length) return { error: `\`${name}\` is a ${logic.type} answer, not one number: read ${answerFieldsHint(logic.type)}` };
        const kind = fields[path[0]];
        if (!kind) return { error: `a ${logic.type} answer has no \`${path[0]}\`: read ${answerFieldsHint(logic.type)}` };
        if (kind !== "distribution") return path.length === 1 ? kind : { error: `\`${text}\` reads past \`${name}.${path[0]}\`` };
        const keys = logic.type === "choice" ? Object.keys(logic.options ?? {}) : (logic.levels ?? []).map((_, i) => String(i));
        if (path.length !== 2) return { error: `read one probability of \`${name}\`, as in ${name}.probabilities["${keys[0] ?? "…"}"]` };
        return keys.includes(path[1]) ? "number" : { error: `\`${name}\` has no ${logic.type === "choice" ? "option" : "level"} "${path[1]}"` };
      }
      if (logic?.kind === "table") {
        if (path.length !== 1) return { error: `read a table's result as \`${name}.outcome\`` };
        if (logic.hit === "collect") {
          return path[0] === "count" ? "number" : { error: `\`${name}\` collects: ask collected(${name}, "…") or read ${name}.count` };
        }
        return path[0] === "outcome" ? "string" : { error: `a table has no \`${path[0]}\`: read \`${name}.outcome\`` };
      }
      if (logic?.kind === "person") {
        return path.length === 1 && path[0] === "outcome" ? "string" : { error: `read a ruling as \`${name}.outcome\`` };
      }
      // Logic of no kind the loom knows is D005's finding.
      return "any";
    },
    answerable(name) {
      const why = known(name);
      if (why) return why;
      // Asking whether a PERSON has ruled would let a rule go on without them.
      return decisions.get(name)?.logic?.kind === "question" ? undefined : `answered() asks about a question, and \`${name}\` is not one`;
    },
    collectable(name, outcome) {
      const why = known(name);
      if (why) return why;
      const d = decisions.get(name);
      if (d?.logic?.kind !== "table" || d.logic.hit !== "collect") return `collected() asks about a table whose hit policy is collect, and \`${name}\` is not one`;
      return outcomesOf(d).includes(outcome) ? undefined : `\`${name}\` has no outcome "${outcome}"`;
    },
  };
}

export function validateDecisionModel(def: DecisionModelDefinition): DmdValidationError[] {
  const issues: DmdValidationError[] = [];
  const err = (ruleId: string, message: string, element?: string): void => {
    issues.push({ ruleId, message, ...(element ? { element } : {}) });
  };
  const warn = (ruleId: string, message: string, element?: string): void => {
    issues.push({ ruleId, message, ...(element ? { element } : {}), severity: "warning" });
  };

  // ── D001, D012: the settings ───────────────────────────────────────────────
  if (blank(def?.settings?.name)) err("D001", "The decision model has no settings.name", "settings");
  if (blank(def?.settings?.version)) {
    err("D012", "The decision model has no settings.version: a run records the version of the rules it ran, and there is none to record", "settings");
  }

  // ── D002: names ────────────────────────────────────────────────────────────
  const inputs = new Set<string>();
  const taken = new Set<string>();
  for (const [i, input] of (def.inputs ?? []).entries()) {
    if (blank(input?.name)) {
      err("D002", `Input at index ${i} has no name`, `inputs[${i}]`);
      continue;
    }
    if (taken.has(input.name)) err("D002", `Duplicate name "${input.name}": inputs and decisions share their names`, `input:${input.name}`);
    taken.add(input.name);
    inputs.add(input.name);
    if (input.type !== undefined && !DMD_INPUT_TYPES.includes(input.type)) {
      err("D002", `Input "${input.name}" has type "${input.type}"; expected one of ${DMD_INPUT_TYPES.join(", ")}`, `input:${input.name}`);
    }
  }
  const decisions = new Map<string, DmdDecision>();
  for (const [i, d] of (def.decisions ?? []).entries()) {
    if (blank(d?.name)) {
      err("D002", `Decision at index ${i} has no name`, `decisions[${i}]`);
      continue;
    }
    if (taken.has(d.name)) err("D002", `Duplicate name "${d.name}": inputs and decisions share their names`, `decision:${d.name}`);
    taken.add(d.name);
    if (!decisions.has(d.name)) decisions.set(d.name, d);
  }
  const knowledge = new Map<string, string>();
  for (const [i, k] of (def.knowledge ?? []).entries()) {
    if (blank(k?.name)) {
      err("D002", `Knowledge at index ${i} has no name`, `knowledge[${i}]`);
      continue;
    }
    if (knowledge.has(k.name)) err("D002", `Duplicate knowledge "${k.name}"`, `knowledge:${k.name}`);
    if (!DMD_KNOWLEDGE_KINDS.includes(k.kind)) {
      err("D002", `Knowledge "${k.name}" has kind "${k.kind ?? ""}"; expected one of ${DMD_KNOWLEDGE_KINDS.join(", ")}`, `knowledge:${k.name}`);
    }
    if (!knowledge.has(k.name)) knowledge.set(k.name, k.kind);
  }

  // ── D018: bars ─────────────────────────────────────────────────────────────
  const bars = new Set<string>();
  for (const [i, b] of (def.bars ?? []).entries()) {
    if (blank(b?.name)) {
      err("D018", `Bar at index ${i} has no name`, `bars[${i}]`);
      continue;
    }
    const element = `bar:${b.name}`;
    if (bars.has(b.name)) err("D018", `Duplicate bar "${b.name}"`, element);
    if (taken.has(b.name)) err("D018", `Bar "${b.name}" has the name of an input or a decision; a rule could not tell them apart`, element);
    if (!VARIABLE_NAME.test(b.name) || RESERVED.has(b.name)) err("D018", `Bar "${b.name}" is not a name a rule can write (a word of letters, digits and _, and not a word of the rule language)`, element);
    if (typeof b.value !== "number" || !Number.isFinite(b.value)) err("D018", `Bar "${b.name}" has no number as its value`, element);
    if (b.calibrated_from !== undefined && (!Number.isInteger(b.calibrated_from) || b.calibrated_from < 0)) {
      err("D018", `Bar "${b.name}" counts ${JSON.stringify(b.calibrated_from)} rulings; calibrated_from is a whole number, 0 or more`, element);
    }
    bars.add(b.name);
  }

  // ── Per decision ───────────────────────────────────────────────────────────
  for (const d of decisions.values()) {
    const element = `decision:${d.name}`;
    const logic = d.logic;

    // D003: what it names exists, and is of the right kind.
    for (const r of d.requires ?? []) {
      if (r === d.name) err("D004", `"${d.name}" requires itself`, element);
      else if (!inputs.has(r) && !decisions.has(r)) err("D003", `"${d.name}" requires "${r}", which is neither an input nor a decision`, element);
    }
    for (const k of d.knowledge ?? []) {
      const kind = knowledge.get(k);
      if (!kind) err("D003", `"${d.name}" uses the knowledge "${k}", which the model does not list`, element);
      else if (kind === "authority") err("D003", `"${d.name}" lists "${k}" as knowledge, and it is an authority: name it under authority`, element);
    }
    for (const a of d.authority ?? []) {
      const kind = knowledge.get(a);
      if (!kind) err("D003", `"${d.name}" answers to "${a}", which the model does not list`, element);
      else if (kind !== "authority") err("D003", `"${d.name}" lists "${a}" as an authority, and it is a ${kind}: name it under knowledge`, element);
    }

    if (!logic || !DMD_LOGIC_KINDS.includes(logic.kind)) {
      err("D005", `"${d.name}" has logic of kind "${(logic as { kind?: string } | undefined)?.kind ?? ""}"; expected one of ${DMD_LOGIC_KINDS.join(", ")}`, element);
      continue;
    }

    // D017: nothing inside a decision names who answers it.
    for (const key of ["model", "provider", "engine"]) {
      if (key in (logic as object)) err("D017", `"${d.name}" names a ${key} inside its logic; who answers is written once, in binding`, element);
    }

    if (logic.kind === "question") {
      // D005: the question itself.
      if (!DMD_QUESTION_TYPES.includes(logic.type)) {
        err("D005", `"${d.name}" has question type "${logic.type ?? ""}"; expected one of ${DMD_QUESTION_TYPES.join(", ")}`, element);
      }
      if (blank(logic.instructions)) err("D005", `"${d.name}" has no instructions`, element);
      if (logic.type === "choice") {
        const n = Object.keys(logic.options ?? {}).length;
        if (n < DMD_LIMITS.MIN_CHOICE_OPTIONS || n > DMD_LIMITS.MAX_CHOICE_OPTIONS) {
          err("D005", `"${d.name}" is a choice with ${n} option(s); a choice has ${DMD_LIMITS.MIN_CHOICE_OPTIONS} to ${DMD_LIMITS.MAX_CHOICE_OPTIONS}`, element);
        }
      }
      if (logic.type === "score") {
        const n = Array.isArray(logic.levels) ? logic.levels.length : 0;
        if (n < DMD_LIMITS.MIN_SCORE_LEVELS || n > DMD_LIMITS.MAX_SCORE_LEVELS) {
          err("D005", `"${d.name}" is a score with ${n} level(s); a score has ${DMD_LIMITS.MIN_SCORE_LEVELS} to ${DMD_LIMITS.MAX_SCORE_LEVELS}`, element);
        }
      }

      // D009: its criterion.
      if (logic.type === "noul") {
        const from = logic.criteria_from;
        if (from !== undefined) {
          if (!inputs.has(from) || !(d.requires ?? []).includes(from)) {
            err("D009", `"${d.name}" takes its criterion from "${from}", which is not an input it requires`, element);
          } else if (!backtickedNames(logic.instructions).includes(from)) {
            err("D009", `"${d.name}" takes its criterion from \`${from}\`, and its instructions never name it: the engine is not told where the criterion is`, element);
          }
        } else if (blank(logic.criteria?.true)) {
          err("D009", `"${d.name}" states no criterion: say in criteria.true what makes it yes, or name in criteria_from the input that carries the acceptance line`, element);
        }
      }
      if (logic.type === "choice") {
        const bare = Object.entries(logic.options ?? {}).filter(([, text]) => blank(text)).map(([k]) => k);
        if (bare.length) err("D009", `"${d.name}" has option(s) with no criterion: ${bare.join(", ")}. Each option says what makes it the one`, element);
      }
      if (logic.type === "score" && Array.isArray(logic.levels)) {
        const bare = logic.levels.map((l, i) => (blank(l) ? i : -1)).filter((i) => i >= 0);
        if (bare.length) err("D009", `"${d.name}" has level(s) with no criterion: ${bare.join(", ")}`, element);
      }

      // D007: what it names in backticks is an input it requires.
      const named = [...new Set(questionTexts(logic).flatMap(backtickedNames))];
      for (const name of named) {
        if ((d.requires ?? []).includes(name)) continue;
        err(
          "D007",
          inputs.has(name) || decisions.has(name)
            ? `"${d.name}" names \`${name}\` in its text and does not require it`
            : `"${d.name}" names \`${name}\` in its text, and the model has no such input`,
          element,
        );
      }
    }

    if (logic.kind === "table") validateTable(def, d, logic, { err, warn, decisions });

    if (logic.kind === "person") {
      // D016: a person's decision is a recorded ruling, and nothing else.
      if (blank(logic.who)) err("D016", `"${d.name}" is a person's decision and does not say who rules`, element);
      if (!outcomesOf(d).length) err("D016", `"${d.name}" lists no outcomes: what can the person rule?`, element);
      for (const key of ["rules", "hit", "failure", "if", "default"]) {
        if (key in (logic as object)) {
          err("D016", `"${d.name}" is a person's decision and carries "${key}": nothing computed stands in for a ruling`, element);
        }
      }
    }

    // D013: every outcome of a decision that drives a machine fires an event.
    if (d.machine !== undefined || d.event !== undefined || d.events !== undefined) {
      const outcomes = outcomesOf(d);
      if (!outcomes.length) err("D013", `"${d.name}" fires events and lists no outcomes`, element);
      for (const key of Object.keys(d.events ?? {})) {
        if (!outcomes.includes(key)) err("D013", `"${d.name}" maps "${key}" to an event, and "${key}" is not one of its outcomes`, element);
      }
      const silent = outcomes.filter((o) => blank(eventOf(d, o)));
      if (silent.length) err("D013", `"${d.name}" drives a machine and gives no event for: ${silent.join(", ")}`, element);
    }
  }

  // ── D004: the requirements form no cycle ───────────────────────────────────
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (name: string, trail: string[]): void => {
    if (state.get(name) === 2) return;
    if (state.get(name) === 1) {
      const loop = [...trail.slice(trail.indexOf(name)), name];
      const key = [...loop].sort().join("|");
      if (!reported.has(key)) err("D004", `The requirements go in a circle: ${loop.join(" → ")}`, `decision:${name}`);
      reported.add(key);
      return;
    }
    state.set(name, 1);
    for (const r of decisions.get(name)?.requires ?? []) if (decisions.has(r) && r !== name) visit(r, [...trail, name]);
    state.set(name, 2);
  };
  for (const name of decisions.keys()) visit(name, []);

  // ── D010: question groups ──────────────────────────────────────────────────
  const groupOf = new Map<string, string>();
  const groupNames = new Set<string>();
  for (const [i, g] of (def.groups ?? []).entries()) {
    if (blank(g?.name)) {
      err("D010", `Group at index ${i} has no name`, `groups[${i}]`);
      continue;
    }
    const element = `group:${g.name}`;
    if (groupNames.has(g.name)) err("D010", `Duplicate group "${g.name}"`, element);
    groupNames.add(g.name);
    const members = Array.isArray(g.questions) ? g.questions : [];
    if (!members.length) err("D010", `Group "${g.name}" holds no question`, element);
    for (const q of members) {
      if (decisions.get(q)?.logic?.kind !== "question") {
        err("D010", `Group "${g.name}" holds "${q}", which is not a question of the model`, element);
        continue;
      }
      const other = groupOf.get(q);
      if (other && other !== g.name) err("D010", `"${q}" is in the groups "${other}" and "${g.name}"; a question goes to the engine once`, element);
      groupOf.set(q, g.name);
    }
    for (const q of members) {
      if (decisions.get(q)?.logic?.kind !== "question") continue;
      const behind = questionsBehind(def, q);
      const needs = members.filter((m) => m !== q && behind.has(m));
      if (needs.length) {
        err("D010", `In group "${g.name}", "${q}" needs the answer of ${needs.map((n) => `"${n}"`).join(", ")}: questions of one group are answered independently, so that is two requests`, element);
      }
    }
  }

  // ── D017: who answers, kept apart ──────────────────────────────────────────
  const binding = def.binding;
  if (binding !== undefined) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) err("D017", "binding is not an object", "binding");
    else {
      for (const key of ["provider", "model"] as const) {
        if (binding[key] !== undefined && blank(binding[key])) err("D017", `binding.${key} is empty`, "binding");
      }
      if (binding.timeout_ms !== undefined && (typeof binding.timeout_ms !== "number" || !(binding.timeout_ms > 0))) {
        err("D017", "binding.timeout_ms is a number of milliseconds above 0", "binding");
      }
      if (binding.credentials !== undefined && (typeof binding.credentials !== "string" || !VARIABLE_NAME.test(binding.credentials))) {
        err("D017", "binding.credentials is the NAME of the environment variable that holds the key; a key is never written in a document", "binding");
      }
    }
  }
  if (!blank(def?.settings?.engine)) {
    warn(
      "D017",
      binding?.model
        ? `settings.engine ("${def.settings.engine}") is draft 0.1's place for the provider's model, and binding.model ("${binding.model}") is the one in force`
        : `settings.engine ("${def.settings.engine}") is draft 0.1's place for the provider's model: write it as binding.model, apart from what is asked`,
      "settings",
    );
  }

  // ── D021: an answer nothing reads ──────────────────────────────────────────
  const read = new Set<string>();
  for (const d of decisions.values()) for (const r of d.requires ?? []) read.add(r);
  for (const d of decisions.values()) {
    if (d.logic?.kind === "question" && !read.has(d.name)) {
      warn("D021", `"${d.name}" is asked and no decision requires its answer`, `decision:${d.name}`);
    }
  }

  // ── D022: the rulings ──────────────────────────────────────────────────────
  const rulings = def.rulings;
  if (rulings !== undefined) {
    if (!rulings || typeof rulings !== "object" || Array.isArray(rulings)) err("D022", "rulings is not an object", "rulings");
    else {
      if (rulings.bar_after !== undefined && (!Number.isInteger(rulings.bar_after) || rulings.bar_after < 1)) {
        err("D022", "rulings.bar_after is a whole number of rulings, 1 or more", "rulings");
      }
      if (rulings.decision !== undefined && decisions.get(rulings.decision)?.logic?.kind !== "person") {
        err("D022", `rulings.decision names "${rulings.decision}", which is not a person's decision of the model`, "rulings");
      }
      const record = rulings.record;
      for (const name of Object.keys(record?.values ?? {})) {
        if (!inputs.has(name)) err("D022", `rulings.record.values names "${name}", which is not an input`, "rulings");
      }
      for (const [name, fields] of Object.entries(record?.answers ?? {})) {
        const logic = decisions.get(name)?.logic;
        if (logic?.kind !== "question") {
          err("D022", `rulings.record.answers names "${name}", which is not a question`, "rulings");
          continue;
        }
        const allowed = logic.type === "noul" ? ["noul"] : logic.type === "choice" ? ["choice", "confidence", "probabilities"] : ["score", "confidence", "probabilities"];
        const unknown = Object.keys(fields ?? {}).filter((f) => !allowed.includes(f));
        const absent = allowed.filter((f) => blank((fields ?? {})[f]));
        if (unknown.length) err("D022", `rulings.record.answers.${name} maps ${unknown.join(", ")}; a ${logic.type} answer has ${allowed.join(", ")}`, "rulings");
        if (absent.length) err("D022", `rulings.record.answers.${name} does not say where ${absent.join(", ")} is`, "rulings");
      }
      for (const name of Object.keys(record?.outcomes ?? {})) {
        if (!decisions.has(name)) err("D022", `rulings.record.outcomes names "${name}", which is not a decision`, "rulings");
      }
    }
  }

  return issues;
}

function validateTable(
  def: DecisionModelDefinition,
  d: DmdDecision,
  logic: DmdTableLogic,
  ctx: {
    err(ruleId: string, message: string, element?: string): void;
    warn(ruleId: string, message: string, element?: string): void;
    decisions: Map<string, DmdDecision>;
  },
): void {
  const { err, warn, decisions } = ctx;
  const element = `decision:${d.name}`;
  const outcomes = outcomesOf(d);
  const rules = Array.isArray(logic.rules) ? logic.rules : [];

  // D011: the hit policy is said.
  if (!DMD_HIT_POLICIES.includes(logic.hit)) {
    err("D011", `"${d.name}" is a table with hit policy "${logic.hit ?? ""}"; say which: ${DMD_HIT_POLICIES.join(", ")}. What several matching rules mean is never left to chance`, element);
  }

  // D006: its rules and what they give.
  if (!rules.length) err("D006", `"${d.name}" is a table with no rule`, element);
  if (!outcomes.length) err("D006", `"${d.name}" is a table that lists no outcomes`, element);
  const env = ruleEnvOf(def, d);
  const wordsOnly: number[] = [];
  const always: number[] = [];
  rules.forEach((rule, i) => {
    const n = i + 1;
    const at = `rule:${d.name}.${n}`;
    if (!rule || typeof rule !== "object") {
      err("D006", `"${d.name}" rule ${n} is empty`, at);
      return;
    }
    if (blank(rule.when)) err("D006", `"${d.name}" rule ${n} has no "when": the rule in words, for whoever reads the drawing`, at);
    const hasThen = rule.then !== undefined;
    const hasFrom = rule.from !== undefined;
    if (hasThen === hasFrom) {
      err("D006", `"${d.name}" rule ${n} needs one of "then" (an outcome) or "from" (a required decision whose value is the outcome)`, at);
    } else if (hasThen) {
      if (!outcomes.includes(rule.then as string)) {
        err("D006", `"${d.name}" rule ${n} gives "${rule.then}", which is not one of its outcomes (${outcomes.join(", ") || "none"})`, at);
      }
    } else {
      const source = decisions.get(rule.from as string);
      const sourceLogic = source?.logic;
      if (!source || !(d.requires ?? []).includes(rule.from as string)) {
        err("D006", `"${d.name}" rule ${n} takes its outcome from "${rule.from}", which is not a decision it requires`, at);
      } else if (
        !(sourceLogic?.kind === "question" && sourceLogic.type === "choice") &&
        !(sourceLogic?.kind === "table" && sourceLogic.hit !== "collect") &&
        sourceLogic?.kind !== "person"
      ) {
        err("D006", `"${d.name}" rule ${n} takes its outcome from "${rule.from}", which gives no single outcome: name a choice question, a table or a person's decision`, at);
      } else {
        const foreign = outcomesOf(source).filter((o) => !outcomes.includes(o));
        if (foreign.length) err("D006", `"${d.name}" rule ${n} takes its outcome from "${rule.from}", which can give ${foreign.join(", ")}: not among the outcomes of "${d.name}"`, at);
      }
    }

    // D014: the rule in the rule language.
    if (rule.if === undefined) {
      wordsOnly.push(n);
      return;
    }
    const parsed = parseRule(rule.if);
    if (!parsed.ok) {
      err("D014", `"${d.name}" rule ${n} cannot be read: ${parsed.error}`, at);
      return;
    }
    if (parsed.ast.t === "otherwise") always.push(n);
    for (const problem of checkRule(parsed.ast, env)) err("D014", `"${d.name}" rule ${n} ${problem}`, at);
  });

  // D020: written in words only.
  if (wordsOnly.length && rules.length) {
    warn(
      "D020",
      `"${d.name}" rule(s) ${wordsOnly.join(", ")} are written in words only ("when" without "if"): the loom draws the table and does not run it`,
      element,
    );
  }

  // D015: where it goes when the engine gives no answer.
  const asks = (d.requires ?? []).some((r) => decisions.get(r)?.logic?.kind === "question");
  if (logic.failure !== undefined) {
    if (blank(logic.failure?.then) || !outcomes.includes(logic.failure.then)) {
      err("D015", `"${d.name}" fails to "${logic.failure?.then ?? ""}", which is not one of its outcomes`, element);
    }
  } else if (asks) {
    err("D015", `"${d.name}" reads an engine's answers and declares no failure route: say in failure.then where it goes when the engine fails or times out`, element);
  }

  // D019: what the rules leave uncovered.
  if (!wordsOnly.length && rules.length && DMD_HIT_POLICIES.includes(logic.hit)) {
    if (logic.hit === "first") {
      const early = always.filter((n) => n !== rules.length);
      if (early.length) warn("D019", `"${d.name}" rule ${early[0]} is "otherwise", so the rules after it never hold`, element);
      if (!always.length) warn("D019", `"${d.name}" has no "otherwise" rule: a run no rule covers has no outcome`, element);
    }
    if (logic.hit === "unique" && always.length) {
      warn("D019", `"${d.name}" allows one rule to hold, and rule ${always[0]} is "otherwise", which holds with every other`, element);
    }
  }
}
