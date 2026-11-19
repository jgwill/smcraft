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

/** The engine's published limits (Jev, Episode 564 study part 1.2), and the loom's own bound on a model's size. */
export const DMD_LIMITS = {
  MIN_CHOICE_OPTIONS: 2,
  MAX_CHOICE_OPTIONS: 255,
  MIN_SCORE_LEVELS: 2,
  MAX_SCORE_LEVELS: 10,
  /** How far a distribution may be from summing to one. */
  SUM_TOLERANCE: 0.025,
  /** A model with more decisions than this is refused, and is not run. */
  MAX_DECISIONS: 500,
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

const isObject = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

/**
 * The value a document's map gives a name, and only its own: a name such as
 * `constructor` finds nothing where the document wrote nothing.
 */
export function own<T>(map: Record<string, T> | null | undefined, key: string): T | undefined {
  return isObject(map) && Object.hasOwn(map, key) ? (map as Record<string, T>)[key] : undefined;
}

/**
 * A name no input, decision, bar, group or option may take: one every
 * JavaScript object already carries (`constructor`, `toString`, `__proto__`).
 * A document that used one would have its lookups answered by the language.
 */
export function isReservedName(name: unknown): boolean {
  return typeof name === "string" && name in Object.prototype;
}

const namesIn = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
const objectsIn = <T>(x: unknown): T[] => (Array.isArray(x) ? (x.filter(isObject) as T[]) : []);
const textMap = (x: unknown): Record<string, string> | undefined =>
  isObject(x) ? Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === "string")) as Record<string, string> : undefined;

/**
 * The document as every reader but the validator sees it: each list is a list
 * and each map a map, whatever a hand or an agent wrote in their place. What is
 * mis-shaped is left out here and REPORTED by `validateDecisionModel`, so a
 * document that is wrong is said to be wrong and never makes a reader throw.
 *
 * Pure. Returns a new document; the input is untouched. A document this
 * function made is returned as it is, so asking twice costs nothing.
 */
export function safeModel(def: unknown): DecisionModelDefinition {
  if (isObject(def) && SAFE.has(def)) return def as unknown as DecisionModelDefinition;
  const d = isObject(def) ? def : {};
  const settings = isObject(d.settings) ? (d.settings as unknown as DmdSettings) : ({ namespace: "", name: "" } as DmdSettings);
  const decisions = objectsIn<Record<string, unknown>>(d.decisions).map((raw) => {
    const logic = isObject(raw.logic) ? { ...raw.logic } : undefined;
    if (logic) {
      if ("rules" in logic) logic.rules = objectsIn(logic.rules);
      if ("levels" in logic) logic.levels = namesIn(logic.levels);
      if ("options" in logic) logic.options = textMap(logic.options) ?? {};
      if ("criteria" in logic && !isObject(logic.criteria)) delete logic.criteria;
      if ("failure" in logic && !isObject(logic.failure)) delete logic.failure;
    }
    const next: Record<string, unknown> = { ...raw, logic };
    for (const key of ["requires", "knowledge", "authority"]) if (key in raw) next[key] = namesIn(raw[key]);
    if ("outcomes" in raw) {
      if (Array.isArray(raw.outcomes)) next.outcomes = namesIn(raw.outcomes);
      else delete next.outcomes;
    }
    if ("events" in raw) next.events = textMap(raw.events) ?? {};
    return next as unknown as DmdDecision;
  });
  const out: DecisionModelDefinition = { settings, decisions };
  if ("inputs" in d) out.inputs = objectsIn<DmdInput>(d.inputs);
  if ("knowledge" in d) out.knowledge = objectsIn<DmdKnowledge>(d.knowledge);
  if ("groups" in d) out.groups = objectsIn<Record<string, unknown>>(d.groups).map((g) => ({ ...g, questions: namesIn(g.questions) }) as unknown as DmdGroup);
  if ("bars" in d) out.bars = objectsIn<DmdBar>(d.bars);
  if (isObject(d.binding)) out.binding = d.binding as DmdBinding;
  if (isObject(d.rulings)) {
    const rulings = { ...d.rulings } as Record<string, unknown>;
    if (isObject(rulings.record)) {
      const record = { ...rulings.record } as Record<string, unknown>;
      if (typeof record.version !== "string") delete record.version;
      for (const key of ["values", "outcomes", "ruling"]) if (key in record) record[key] = textMap(record[key]) ?? {};
      if ("answers" in record) {
        record.answers = isObject(record.answers)
          ? Object.fromEntries(Object.entries(record.answers).map(([name, fields]) => [name, textMap(fields) ?? {}]))
          : {};
      }
      rulings.record = record;
    } else delete rulings.record;
    out.rulings = rulings as DmdRulings;
  }
  SAFE.add(out);
  return out;
}

const SAFE = new WeakSet<object>();

export function emptyDecisionModel(namespace: string, name: string, description?: string): DecisionModelDefinition {
  return {
    settings: description ? { namespace, name, description, version: "0.1.0" } : { namespace, name, version: "0.1.0" },
    inputs: [],
    knowledge: [],
    decisions: [],
  };
}

export function decisionOf(def: DecisionModelDefinition, name: string): DmdDecision | undefined {
  return safeModel(def).decisions.find((d) => d.name === name);
}

/**
 * What a decision can decide. A choice question decides one of its options,
 * whatever `outcomes` it also writes (D005 asks that they agree): the option
 * the engine picks is the value a table takes `from` it. Every other decision
 * decides one of its `outcomes`.
 */
export function outcomesOf(decision: DmdDecision | undefined): string[] {
  if (!decision) return [];
  if (decision.logic?.kind === "question" && decision.logic.type === "choice") {
    return isObject(decision.logic.options) ? Object.keys(decision.logic.options) : [];
  }
  if (Array.isArray(decision.outcomes)) return decision.outcomes.filter((o) => typeof o === "string");
  return [];
}

/** The event an outcome fires, when the decision drives a machine. */
export function eventOf(decision: DmdDecision, outcome: string): string | undefined {
  return own(decision.events, outcome) ?? decision.event;
}

/** The provider's model in force: `binding.model`, else draft 0.1's `settings.engine`. */
export function bindingOf(def: DecisionModelDefinition): DmdBinding {
  const binding = { ...(def.binding ?? {}) };
  if (!binding.model && def.settings?.engine) binding.model = def.settings.engine;
  return binding;
}

/**
 * The bars in force for a run: the document's, with the caller's overrides on
 * top. An override names a bar the document has, or it is ignored: a caller
 * tries a value, it never adds a bar.
 */
export function barsOf(def: DecisionModelDefinition, overrides?: Record<string, number> | null): Record<string, number> {
  const bars = new Map<string, number>();
  for (const b of Array.isArray(def.bars) ? def.bars : []) {
    if (b && typeof b.name === "string" && b.name && !isReservedName(b.name) && typeof b.value === "number" && Number.isFinite(b.value)) {
      bars.set(b.name, b.value);
    }
  }
  for (const [name, value] of Object.entries(isObject(overrides) ? overrides : {})) {
    if (bars.has(name) && typeof value === "number" && Number.isFinite(value)) bars.set(name, value);
  }
  return Object.fromEntries(bars);
}

/**
 * The decisions in an order where each comes after what it requires, document
 * order otherwise. A cycle (D004) leaves its members at the end, in document
 * order, so a reader still meets every decision once.
 */
export function decisionsInOrder(def: DecisionModelDefinition): DmdDecision[] {
  const all = safeModel(def).decisions.filter((d) => typeof d.name === "string" && d.name);
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
  const byName = new Map(safeModel(def).decisions.map((d) => [d.name, d]));
  const out = new Set<string>();
  const seen = new Set<string>();
  // A list to walk, not a call per step: a long chain of requirements never exhausts the stack.
  const todo = [name];
  while (todo.length) {
    for (const r of byName.get(todo.pop() as string)?.requires ?? []) {
      if (seen.has(r)) continue;
      seen.add(r);
      const d = byName.get(r);
      if (!d) continue;
      if (d.logic?.kind === "question") out.add(r);
      todo.push(r);
    }
  }
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
export function requestGroups(model: DecisionModelDefinition): DmdRequestGroup[] {
  const def = safeModel(model);
  const questions = decisionsInOrder(def).filter((d) => d.logic?.kind === "question");
  const out: DmdRequestGroup[] = [];
  const grouped = new Set<string>();
  for (const g of def.groups ?? []) {
    if (typeof g.name !== "string" || !g.name) continue;
    const members = (g.questions ?? []).filter((q) => questions.some((d) => d.name === q));
    members.forEach((q) => grouped.add(q));
    out.push({ name: g.name, questions: members, declared: true });
  }
  // A request the loom makes never takes the name of one the document wrote (D010 refuses the clash too).
  const taken = new Set(out.map((g) => g.name));
  const named = (want: string): string => {
    let name = want;
    for (let n = 2; taken.has(name); n += 1) name = `${want}-${n}`;
    taken.add(name);
    return name;
  };
  const free = questions.filter((d) => !grouped.has(d.name));
  const independent = free.filter((d) => questionsBehind(def, d.name).size === 0).map((d) => d.name);
  if (independent.length) out.push({ name: named("default"), questions: independent, declared: false });
  for (const d of free) if (questionsBehind(def, d.name).size > 0) out.push({ name: named(d.name), questions: [d.name], declared: false });
  return out;
}
