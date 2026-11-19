/**
 * DMDF — the Decision Model Definition Format (Spec 85).
 *
 * The fourth drawing of the loom, beside SMDF (behaviour), ERDF (data) and
 * SQDF (scenarios): how a decision is made. It keeps DMN's requirements
 * vocabulary (decisions, input data, knowledge, authority) and adds two kinds
 * of logic DMN lacks: a QUESTION put to a decision engine, answered with a
 * typed judgment, and a PERSON, a decision that is only ever a recorded ruling.
 *
 * Three boundaries the format holds:
 *
 * - The engine makes judgments, a table makes the decision. A question's answer
 *   is typed (`answers.ts`) and a table reads it through that type, never as one
 *   generic number (`expression.ts`).
 * - A person's ruling is a decision of its own. Nothing computed produces it,
 *   and nothing computed stands in for it (`evaluate.ts`).
 * - What is asked is kept apart from who answers: `binding` names the provider,
 *   the rest of the document does not.
 *
 * It links to its siblings by name only, as ERDF and SQDF do: an input may BE
 * an entity, an outcome may FIRE an event of a machine. Those names are what
 * `checkSystem` resolves (D008).
 */

export interface DmdSettings {
  namespace: string;
  name: string;
  description?: string;
  /** Working notes about the whole model, for whoever opens it next — a person or an agent. */
  notes?: string;
  /** The definition's version. Every run records it, so a ruling is always read against the rules it answered. */
  version?: string;
  /** Draft 0.1 wrote the provider's model here. It is read as `binding.model` when the document has no `binding`. */
  engine?: string;
}

export type DmdInputType = "string" | "number" | "boolean";

export const DMD_INPUT_TYPES: readonly DmdInputType[] = ["string", "number", "boolean"];

/** DMN's Input Data: what the decision reads. */
export interface DmdInput {
  name: string;
  description?: string;
  notes?: string;
  /** An ERDF entity this input is (Spec 80), checked by the system (D008). */
  entity?: string;
  /** What a rule may do with it. Absent: the value is compared as it is given. */
  type?: DmdInputType;
}

/**
 * - `source`: a document the decision rests on (a study, a skill).
 * - `model`: logic several decisions reuse (DMN's business knowledge model).
 * - `authority`: who or what governs the decision whatever the number.
 */
export type DmdKnowledgeKind = "source" | "model" | "authority";

export const DMD_KNOWLEDGE_KINDS: readonly DmdKnowledgeKind[] = ["source", "model", "authority"];

export interface DmdKnowledge {
  name: string;
  kind: DmdKnowledgeKind;
  /** A loom, chronicle, repository or file address. */
  ref?: string;
  description?: string;
  notes?: string;
}

/**
 * What an engine can be asked. A `noul` is a proposition (is this true?), a
 * `choice` picks one of an unordered set, a `score` places something on ordered
 * levels. Each has its own answer (`answers.ts`).
 */
export type DmdQuestionType = "noul" | "choice" | "score";

export const DMD_QUESTION_TYPES: readonly DmdQuestionType[] = ["noul", "choice", "score"];

/** The engine's published limits (Jev, Episode 564 study part 1.2). */
export const DMD_LIMITS = {
  MIN_CHOICE_OPTIONS: 2,
  MAX_CHOICE_OPTIONS: 255,
  MIN_SCORE_LEVELS: 2,
  MAX_SCORE_LEVELS: 10,
  /** How far a distribution may be from summing to one. */
  SUM_TOLERANCE: 0.025,
} as const;

export interface DmdQuestionLogic {
  kind: "question";
  type: DmdQuestionType;
  /** The question. An input is named in backticks, and only one the decision requires (D007). */
  instructions: string;
  /** A noul's criterion: what makes it yes, and what makes it no. */
  criteria?: { true?: string; false?: string };
  /** A noul's criterion when it arrives with the run: an input the decision requires (an acceptance line). */
  criteria_from?: string;
  /** A choice's options, each with what makes it the one. */
  options?: Record<string, string>;
  /** A score's levels, lowest first. */
  levels?: string[];
  /** The options' order changes per call and the order used is recorded (study jaggedness item 8). */
  rotate?: boolean;
}

/** `first`: the first rule that holds. `unique`: exactly one may hold. `collect`: every rule that holds, in order. */
export type DmdHitPolicy = "first" | "unique" | "collect";

export const DMD_HIT_POLICIES: readonly DmdHitPolicy[] = ["first", "unique", "collect"];

export interface DmdRule {
  /** The rule in words. What a person reads on the drawing. */
  when: string;
  /** The same rule in the rule language (`expression.ts`). Without it the loom draws the rule and does not run it. */
  if?: string;
  /** The outcome, one of the decision's `outcomes`. */
  then?: string;
  /** A required decision whose own value is the outcome (a choice question's option, a table's outcome). */
  from?: string;
  notes?: string;
}

export interface DmdTableLogic {
  kind: "table";
  hit: DmdHitPolicy;
  rules: DmdRule[];
  /** Where the table goes when a question it reads has no valid answer: the engine failed, timed out or broke its contract. */
  failure?: { then: string; description?: string };
}

export interface DmdPersonLogic {
  kind: "person";
  /** Who rules: the seat, a named person, a circle. */
  who: string;
  description?: string;
}

export type DmdLogic = DmdQuestionLogic | DmdTableLogic | DmdPersonLogic;

export const DMD_LOGIC_KINDS: readonly DmdLogic["kind"][] = ["question", "table", "person"];

export interface DmdDecision {
  name: string;
  description?: string;
  notes?: string;
  logic: DmdLogic;
  /** Inputs and other decisions this one reads (information requirements). */
  requires?: string[];
  /** `source` or `model` knowledge it uses. */
  knowledge?: string[];
  /** `authority` knowledge that governs it. */
  authority?: string[];
  /** What it can decide. A choice question's option keys when absent. */
  outcomes?: string[];
  /** One machine event for every outcome (the outcome travels as its parameter). */
  event?: string;
  /** One machine event per outcome. Wins over `event` for the outcomes it names. */
  events?: Record<string, string>;
  /** `settings.name` of the machine the events are for, when several define them. */
  machine?: string;
}

/**
 * Questions that go to the engine in one request: they see the same snapshot
 * and are answered independently. A group is never a dependency: a question
 * that needs another's answer `requires` it, and is then in another request.
 */
export interface DmdGroup {
  name: string;
  questions: string[];
  description?: string;
}

/**
 * A threshold a rule reads by name. A bar is a choice someone made: `set_by`
 * names them, and `calibrated_from` counts the rulings it was checked against.
 */
export interface DmdBar {
  name: string;
  value: number;
  description?: string;
  set_by?: string;
  calibrated_from?: number;
}

/** Who answers the questions. Never part of what is asked, and never a secret. */
export interface DmdBinding {
  provider?: string;
  model?: string;
  timeout_ms?: number;
  /** The NAME of the environment variable that holds the key. */
  credentials?: string;
}

/**
 * Where, in one line of a ledger written before this version, each recorded
 * thing is. Every path is dot-separated (`triggers.deletes`). Absent, a line is
 * read in the format's own shape: `values.<input>`, `answers.<question>`,
 * `outcomes.<decision>`, `definition.version`.
 */
export interface DmdLedgerRecord {
  version?: string;
  values?: Record<string, string>;
  /** Per question, the path of each field of its typed answer (`noul`; `choice`, `confidence`, `probabilities`; `score`). */
  answers?: Record<string, Record<string, string>>;
  outcomes?: Record<string, string>;
  /** Paths inside a ruling line. */
  ruling?: { outcome?: string; by?: string; words?: string; at?: string };
}

export interface DmdRulings {
  /** The file where each run and each ruling are kept. The loom reads it and never writes it. */
  ledger?: string;
  /** A copy of the ledger kept beside the document. */
  snapshot?: string;
  /** The field of a ruling line that names the run it answers. */
  key?: string;
  /** The count of standing rulings after which a person may set a bar. */
  bar_after?: number;
  /** The `person` decision these rulings are the outcome of. */
  decision?: string;
  record?: DmdLedgerRecord;
}

export interface DecisionModelDefinition {
  settings: DmdSettings;
  inputs?: DmdInput[];
  knowledge?: DmdKnowledge[];
  decisions: DmdDecision[];
  groups?: DmdGroup[];
  bars?: DmdBar[];
  binding?: DmdBinding;
  rulings?: DmdRulings;
}

/** The canonical extension; tools pick the document type from it. */
export const DMDF_EXTENSION = ".dmdf.json";

export function isDmdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(DMDF_EXTENSION);
}

/**
 * Tell a decision model from its siblings when only content is at hand: it
 * carries `decisions`, and never `participants`, `entities`, `members` or a
 * `state` tree.
 */
export function isDecisionModelDefinition(doc: unknown): doc is DecisionModelDefinition {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return (
    Array.isArray(d.decisions) && !("state" in d) && !("entities" in d) && !("participants" in d) && !("members" in d)
  );
}

export function emptyDecisionModel(namespace: string, name: string, description?: string): DecisionModelDefinition {
  return {
    settings: description ? { namespace, name, description, version: "0.1.0" } : { namespace, name, version: "0.1.0" },
    inputs: [],
    knowledge: [],
    decisions: [],
  };
}

export function decisionOf(def: DecisionModelDefinition, name: string): DmdDecision | undefined {
  return (def.decisions ?? []).find((d) => d?.name === name);
}

/** What a decision can decide: its `outcomes`, or a choice question's option keys. */
export function outcomesOf(decision: DmdDecision | undefined): string[] {
  if (!decision) return [];
  if (Array.isArray(decision.outcomes)) return decision.outcomes.filter((o) => typeof o === "string");
  if (decision.logic?.kind === "question" && decision.logic.type === "choice") return Object.keys(decision.logic.options ?? {});
  return [];
}

/** The event an outcome fires, when the decision drives a machine. */
export function eventOf(decision: DmdDecision, outcome: string): string | undefined {
  return decision.events?.[outcome] ?? decision.event;
}

/** The provider's model in force: `binding.model`, else draft 0.1's `settings.engine`. */
export function bindingOf(def: DecisionModelDefinition): DmdBinding {
  const binding = { ...(def.binding ?? {}) };
  if (!binding.model && def.settings?.engine) binding.model = def.settings.engine;
  return binding;
}

/** The bars in force for a run: the document's, with the caller's overrides on top. */
export function barsOf(def: DecisionModelDefinition, overrides: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of def.bars ?? []) if (b?.name && typeof b.value === "number") out[b.name] = b.value;
  for (const [name, value] of Object.entries(overrides)) if (name in out && typeof value === "number") out[name] = value;
  return out;
}

/**
 * The decisions in an order where each comes after what it requires, document
 * order otherwise. A cycle (D004) leaves its members at the end, in document
 * order, so a reader still meets every decision once.
 */
export function decisionsInOrder(def: DecisionModelDefinition): DmdDecision[] {
  const all = (def.decisions ?? []).filter((d) => d?.name);
  const names = new Set(all.map((d) => d.name));
  const placed = new Set<string>();
  const out: DmdDecision[] = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const d of all) {
      if (placed.has(d.name)) continue;
      const waits = (d.requires ?? []).some((r) => names.has(r) && r !== d.name && !placed.has(r));
      if (waits) continue;
      placed.add(d.name);
      out.push(d);
      moved = true;
    }
  }
  for (const d of all) if (!placed.has(d.name)) out.push(d);
  return out;
}

/** Every question a decision depends on, through any number of decisions. */
export function questionsBehind(def: DecisionModelDefinition, name: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (n: string): void => {
    for (const r of decisionOf(def, n)?.requires ?? []) {
      if (seen.has(r)) continue;
      seen.add(r);
      const d = decisionOf(def, r);
      if (!d) continue;
      if (d.logic?.kind === "question") out.add(r);
      walk(r);
    }
  };
  walk(name);
  return out;
}

export interface DmdRequestGroup {
  name: string;
  questions: string[];
  /** Written in the document, or made by the loom for questions no group names. */
  declared: boolean;
}

/**
 * The requests a model makes of its engine, in the order they can be sent.
 * Declared groups first, as written. Then the questions no group names: those
 * that wait on no other question share one request (`default`), and each
 * question that needs another's answer is a request of its own.
 */
export function requestGroups(def: DecisionModelDefinition): DmdRequestGroup[] {
  const questions = decisionsInOrder(def).filter((d) => d.logic?.kind === "question");
  const out: DmdRequestGroup[] = [];
  const grouped = new Set<string>();
  for (const g of def.groups ?? []) {
    if (!g?.name) continue;
    const members = (g.questions ?? []).filter((q) => questions.some((d) => d.name === q));
    members.forEach((q) => grouped.add(q));
    out.push({ name: g.name, questions: members, declared: true });
  }
  const free = questions.filter((d) => !grouped.has(d.name));
  const independent = free.filter((d) => questionsBehind(def, d.name).size === 0).map((d) => d.name);
  if (independent.length) out.push({ name: "default", questions: independent, declared: false });
  for (const d of free) if (questionsBehind(def, d.name).size > 0) out.push({ name: d.name, questions: [d.name], declared: false });
  return out;
}
