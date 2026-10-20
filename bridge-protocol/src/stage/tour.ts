/**
 * Tours and marks — what an agent shows and what a person points at.
 *
 * A **tour** (`<name>.tour.json`) is a walk through drawings an agent prepared:
 * each step opens one drawing, lights some of its elements and says something
 * about them. A host plays it like a short presentation — the camera moves to
 * the lit elements, a caption shows the words, a voice may say them.
 *
 * A **mark** is the other direction: a person selected elements on a drawing
 * and wrote (or said) something about them. Marks are appended one per line to
 * `marks.jsonl` beside the drawings, so the agent's next turn reads exactly
 * what was pointed at, in the person's words.
 *
 * Both name elements with the focus strings a system already uses
 * (`<kind>:<name>`, Spec 82): `state:Recording`, `transition:Idle:0`,
 * `event:submit`, `entity:WaveCount`, `participant:Chart`, `message:9`.
 * Drawings are named by path relative to the tour file (or to `marks.jsonl`),
 * so a folder of drawings, tours and marks moves as one.
 *
 * Pure data: no filesystem, no DOM, no clock unless the caller passes one.
 */

export const TOUR_FORMAT = "stateloom.tour.v1";
export const MARK_FORMAT = "stateloom.mark.v1";
export const TOUR_EXTENSION = ".tour.json";
export const MARKS_FILE = "marks.jsonl";

/** How long a step holds when nothing is spoken. */
export const DEFAULT_HOLD_MS = 6000;

export interface TourStep {
  /** The drawing this step opens, relative to the tour file. Absent: the previous step's. */
  member?: string;
  /** What is lit, as focus strings. Empty or absent: the whole drawing. */
  focus?: string[];
  /** A few words over the caption. */
  title?: string;
  /** The caption. */
  text: string;
  /** What a voice says, when it should differ from the caption. */
  say?: string;
  /** How long the step holds when nothing is spoken, in ms. */
  holdMs?: number;
}

export interface StageTour {
  format: typeof TOUR_FORMAT;
  title: string;
  /** Who prepared it (`mia`, an agent name). */
  by?: string;
  createdAt?: string;
  /** One or two sentences: what the tour is for. */
  summary?: string;
  steps: TourStep[];
}

export type MarkKind = "question" | "concern" | "change" | "agree" | "note";

export const MARK_KINDS: readonly MarkKind[] = ["question", "concern", "change", "agree", "note"];

export type MarkStatus = "open" | "answered" | "resolved";

export interface StageMark {
  format: typeof MARK_FORMAT;
  id: string;
  /** ISO time the mark was made. */
  at: string;
  /** Who made it. */
  by?: string;
  /** The drawing, relative to `marks.jsonl`. */
  member: string;
  /** What was selected. Empty: the drawing as a whole. */
  focus: string[];
  kind: MarkKind;
  note: string;
  /** The tour and step that were showing when the mark was made. */
  tour?: string;
  step?: number;
  status?: MarkStatus;
  /** The agent's answer, once there is one. */
  answer?: string;
}

/** What a host sends to make a mark; the rest is stamped on the way to the file. */
export interface MarkDraft {
  member: string;
  focus?: string[];
  kind?: MarkKind;
  note: string;
  by?: string;
  tour?: string;
  step?: number;
}

export interface FormatResult<T> {
  value: T | null;
  issues: string[];
}

export function isTourPath(path: string): boolean {
  return path.toLowerCase().endsWith(TOUR_EXTENSION);
}

const FOCUS = /^[a-z]+:.+$/;

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function focusList(raw: unknown, where: string, issues: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push(`${where}: focus is a list of "<kind>:<name>" strings`);
    return [];
  }
  const out: string[] = [];
  for (const f of raw) {
    if (typeof f === "string" && FOCUS.test(f)) out.push(f);
    else issues.push(`${where}: ${JSON.stringify(f)} is not a "<kind>:<name>" focus`);
  }
  return out;
}

/**
 * Read a tour. A tour with no steps, or with a step that has no words, is
 * refused; a bad focus string is dropped and reported, so one typo does not
 * cost the whole presentation.
 */
export function readTour(raw: unknown): FormatResult<StageTour> {
  const issues: string[] = [];
  if (!isRecord(raw)) return { value: null, issues: ["a tour is a JSON object"] };
  if (raw.format !== undefined && raw.format !== TOUR_FORMAT) {
    issues.push(`format is ${JSON.stringify(raw.format)}; this reader knows ${TOUR_FORMAT}`);
  }
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "";
  if (!title) issues.push("a tour needs a title");
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    return { value: null, issues: [...issues, "a tour needs at least one step"] };
  }
  const steps: TourStep[] = [];
  let member: string | undefined;
  raw.steps.forEach((s, i) => {
    const where = `step ${i + 1}`;
    if (!isRecord(s)) {
      issues.push(`${where}: a step is an object`);
      return;
    }
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (!text) {
      issues.push(`${where}: a step needs text`);
      return;
    }
    if (typeof s.member === "string" && s.member.trim()) member = s.member.trim();
    if (!member) issues.push(`${where}: no drawing is open yet; the first step names a member`);
    const step: TourStep = { text, focus: focusList(s.focus, where, issues) };
    if (member) step.member = member;
    if (typeof s.title === "string" && s.title.trim()) step.title = s.title.trim();
    if (typeof s.say === "string" && s.say.trim()) step.say = s.say.trim();
    if (typeof s.holdMs === "number" && Number.isFinite(s.holdMs) && s.holdMs > 0) step.holdMs = Math.round(s.holdMs);
    steps.push(step);
  });
  if (steps.length === 0 || !title || steps.some((s) => !s.member)) return { value: null, issues };
  const tour: StageTour = { format: TOUR_FORMAT, title, steps };
  if (typeof raw.by === "string" && raw.by.trim()) tour.by = raw.by.trim();
  if (typeof raw.createdAt === "string") tour.createdAt = raw.createdAt;
  if (typeof raw.summary === "string" && raw.summary.trim()) tour.summary = raw.summary.trim();
  return { value: tour, issues };
}

/** The drawings a tour opens, in the order it first opens them. */
export function tourMembers(tour: StageTour): string[] {
  const seen: string[] = [];
  for (const s of tour.steps) if (s.member && !seen.includes(s.member)) seen.push(s.member);
  return seen;
}

/** The words a voice says for a step. */
export function stepSpeech(step: TourStep): string {
  return step.say ?? (step.title ? `${step.title}. ${step.text}` : step.text);
}

function readMark(raw: unknown, where: string, issues: string[]): StageMark | null {
  if (!isRecord(raw)) {
    issues.push(`${where}: not an object`);
    return null;
  }
  const note = typeof raw.note === "string" ? raw.note : "";
  const member = typeof raw.member === "string" ? raw.member : "";
  const id = typeof raw.id === "string" ? raw.id : "";
  const at = typeof raw.at === "string" ? raw.at : "";
  if (!id || !at || !member) {
    issues.push(`${where}: a mark needs id, at and member`);
    return null;
  }
  const kind = MARK_KINDS.includes(raw.kind as MarkKind) ? (raw.kind as MarkKind) : "note";
  const mark: StageMark = { format: MARK_FORMAT, id, at, member, focus: focusList(raw.focus, where, issues), kind, note };
  if (typeof raw.by === "string") mark.by = raw.by;
  if (typeof raw.tour === "string") mark.tour = raw.tour;
  if (typeof raw.step === "number") mark.step = raw.step;
  if (raw.status === "open" || raw.status === "answered" || raw.status === "resolved") mark.status = raw.status;
  if (typeof raw.answer === "string") mark.answer = raw.answer;
  return mark;
}

/**
 * Read `marks.jsonl`. A later line with the same id replaces an earlier one, so
 * an answer or a resolution is appended, never edited in place.
 */
export function readMarks(jsonl: string): { marks: StageMark[]; issues: string[] } {
  const issues: string[] = [];
  const byId = new Map<string, StageMark>();
  jsonl.split("\n").forEach((line, i) => {
    const text = line.trim();
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      issues.push(`line ${i + 1}: not JSON`);
      return;
    }
    const mark = readMark(parsed, `line ${i + 1}`, issues);
    if (!mark) return;
    const earlier = byId.get(mark.id);
    byId.set(mark.id, earlier ? { ...earlier, ...mark } : mark);
  });
  return { marks: [...byId.values()], issues };
}

/**
 * A draft made into a mark. `id` and `now` are passed in so the function stays
 * pure; a host gives `crypto.randomUUID()` and `new Date()`.
 */
export function markFromDraft(draft: MarkDraft, id: string, now: Date): FormatResult<StageMark> {
  // A bad focus string is dropped and reported; these refuse the mark.
  const refusals: string[] = [];
  const issues: string[] = [];
  const note = typeof draft.note === "string" ? draft.note.trim() : "";
  const member = typeof draft.member === "string" ? draft.member.trim() : "";
  if (!member) refusals.push("a mark names the drawing it is on");
  if (member.split("/").includes("..") || member.startsWith("/")) refusals.push("a mark's drawing is a path inside the folder");
  const focus = focusList(draft.focus ?? [], "mark", issues);
  if (!note && focus.length === 0) refusals.push("a mark says something or points at something");
  if (refusals.length > 0) return { value: null, issues: [...refusals, ...issues] };
  const kind = MARK_KINDS.includes(draft.kind as MarkKind) ? (draft.kind as MarkKind) : "note";
  const mark: StageMark = { format: MARK_FORMAT, id, at: now.toISOString(), member, focus, kind, note, status: "open" };
  if (draft.by?.trim()) mark.by = draft.by.trim();
  if (draft.tour?.trim()) mark.tour = draft.tour.trim();
  if (typeof draft.step === "number" && Number.isInteger(draft.step) && draft.step >= 0) mark.step = draft.step;
  return { value: mark, issues };
}

/** One line of `marks.jsonl`, newline included. */
export function markLine(mark: StageMark): string {
  return `${JSON.stringify(mark)}\n`;
}

/** A mark as one sentence an agent reads at the top of its turn. */
export function describeMark(mark: StageMark): string {
  const where = mark.focus.length > 0 ? mark.focus.join(", ") : "the whole drawing";
  const during = mark.tour ? ` during ${mark.tour}${mark.step !== undefined ? ` step ${mark.step + 1}` : ""}` : "";
  const who = mark.by ? `${mark.by}: ` : "";
  const note = mark.note ? ` — ${mark.note}` : "";
  return `${who}${mark.kind} on ${where} in ${mark.member}${during}${note}`;
}
