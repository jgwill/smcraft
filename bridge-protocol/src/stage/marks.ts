/**
 * Marks as data (Spec 83): read a sidecar defensively, and change it with pure
 * functions. Whoever holds the file — the web route, the MCP server, the CLI —
 * reads it, applies one of these, and writes it back; the same rules hold for
 * all of them.
 */
import type { Box } from "../viewport.js";
import { parseFocus } from "../system/check.js";
import {
  MARK_KINDS,
  MARK_STATUSES,
  type Mark,
  type MarkAuthor,
  type MarkInput,
  type MarkKind,
  type MarkReply,
  type MarkRole,
  type MarkStatus,
  type MarksEnvelope,
  type MarksFile,
} from "./definition.js";

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function finiteBox(v: unknown): Box | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  const n = (k: string): number => (typeof b[k] === "number" && Number.isFinite(b[k]) ? (b[k] as number) : NaN);
  const box = { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
  if (Object.values(box).some(Number.isNaN) || box.width <= 0 || box.height <= 0) return undefined;
  return box;
}

function readAuthor(v: unknown): MarkAuthor {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const role: MarkRole = o.role === "agent" ? "agent" : "person";
  const name = text(o.name) || text(o.id) || (role === "agent" ? "agent" : "someone");
  return { id: text(o.id) || name, name, role };
}

function readReply(v: unknown): MarkReply | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const t = text(o.text).trim();
  if (!t) return null;
  return { author: readAuthor(o.author), text: t, at: text(o.at) };
}

/** One mark as a reader can trust it: every field its type, or the mark dropped when it says nothing. */
export function readMark(v: unknown): Mark | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = text(o.id);
  const said = text(o.text).trim();
  if (!id || !said) return null;
  const elements = Array.isArray(o.elements) ? o.elements.filter((e): e is string => typeof e === "string" && e.length > 0) : [];
  const region = finiteBox(o.region);
  const replies = Array.isArray(o.replies) ? o.replies.map(readReply).filter((r): r is MarkReply => r !== null) : [];
  return {
    id,
    kind: MARK_KINDS.includes(o.kind as MarkKind) ? (o.kind as MarkKind) : "comment",
    ...(elements.length ? { elements } : {}),
    ...(region ? { region } : {}),
    ...(text(o.level) ? { level: text(o.level) } : {}),
    text: said,
    author: readAuthor(o.author),
    at: text(o.at),
    status: MARK_STATUSES.includes(o.status as MarkStatus) ? (o.status as MarkStatus) : "open",
    ...(replies.length ? { replies } : {}),
  };
}

/** A sidecar as parsed JSON, read defensively. Anything that is not one reads as no marks. */
export function readMarksFile(v: unknown, docName = ""): MarksFile {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const marks = Array.isArray(o.marks) ? o.marks.map(readMark).filter((m): m is Mark => m !== null) : [];
  return { doc: text(o.doc) || docName, marks };
}

/** `m-<time><random>`: sortable by when it was made (the time is fixed-width), unique enough for one drawing. */
export function newMarkId(now: number = Date.now(), random: () => number = Math.random): string {
  return `m-${Math.max(0, Math.floor(now)).toString(36).padStart(9, "0")}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

/** Why a mark cannot be made, or null. */
export function markInputProblem(input: MarkInput): string | null {
  if (!text(input.text).trim()) return "a mark says something: text is empty";
  if (input.kind && !MARK_KINDS.includes(input.kind)) return `kind is one of ${MARK_KINDS.join(", ")} (got '${input.kind}')`;
  for (const e of input.elements ?? []) {
    if (!parseFocus(e)) return `each element is <kind>:<name> (got '${e}')`;
  }
  if (input.region !== undefined && !finiteBox(input.region)) return "region is { x, y, width, height } with a positive width and height";
  return null;
}

export function addMark(file: MarksFile, input: MarkInput, at: string, id: string = newMarkId()): MarksFile {
  const problem = markInputProblem(input);
  if (problem) throw new Error(problem);
  const elements = [...new Set((input.elements ?? []).filter(Boolean))];
  const region = input.region ? finiteBox(input.region) : undefined;
  const mark: Mark = {
    id,
    kind: input.kind ?? "comment",
    ...(elements.length ? { elements } : {}),
    ...(region ? { region } : {}),
    ...(input.level ? { level: input.level } : {}),
    text: input.text.trim(),
    author: readAuthor(input.author),
    at,
    status: "open",
  };
  return { ...file, marks: [...file.marks, mark] };
}

function withMark(file: MarksFile, id: string, change: (m: Mark) => Mark): MarksFile {
  const i = file.marks.findIndex((m) => m.id === id);
  if (i < 0) throw new Error(`no mark '${id}' on ${file.doc || "this drawing"}`);
  return { ...file, marks: file.marks.map((m, j) => (j === i ? change(m) : m)) };
}

/**
 * Add a reply to a mark's thread. A reply from the other side answers it (an
 * agent replying to a person, a person to an agent); a follow-up from the same
 * side opens it again — the author added to what they asked. A resolved mark
 * stays resolved unless `reopen` says otherwise.
 */
export function replyToMark(file: MarksFile, id: string, reply: { author: MarkAuthor; text: string }, at: string, reopen = false): MarksFile {
  const said = text(reply.text).trim();
  if (!said) throw new Error("a reply says something: text is empty");
  return withMark(file, id, (m) => {
    const author = readAuthor(reply.author);
    const status: MarkStatus =
      m.status === "resolved" && !reopen ? "resolved" : author.role !== m.author.role ? "answered" : "open";
    return { ...m, status, replies: [...(m.replies ?? []), { author, text: said, at }] };
  });
}

export function resolveMark(file: MarksFile, id: string): MarksFile {
  return withMark(file, id, (m) => ({ ...m, status: "resolved" }));
}

export function reopenMark(file: MarksFile, id: string): MarksFile {
  return withMark(file, id, (m) => ({ ...m, status: "open" }));
}

export function removeMark(file: MarksFile, id: string): MarksFile {
  if (!file.marks.some((m) => m.id === id)) throw new Error(`no mark '${id}' on ${file.doc || "this drawing"}`);
  return { ...file, marks: file.marks.filter((m) => m.id !== id) };
}

/**
 * The marks that wait on `role`: a person's open marks wait on an agent, and an
 * agent's open questions wait on a person. Answered marks wait on the side that
 * asked, which may follow up or resolve them.
 */
export function marksWaitingOn(marks: readonly Mark[], role: MarkRole): Mark[] {
  return marks.filter((m) => (m.status === "open" && m.author.role !== role) || (m.status === "answered" && m.author.role === role));
}

/** Whose word is last in a mark's thread: the last reply's author, or the mark's own. */
export function lastWordOf(mark: Pick<Mark, "author" | "replies">): MarkRole {
  return mark.replies?.length ? mark.replies[mark.replies.length - 1].author.role : mark.author.role;
}

/**
 * What a person has read of one drawing's marks: mark id → how many replies its
 * thread had when they last opened it. The host keeps it (a browser in
 * `localStorage`, per drawing); these functions only read and extend it.
 */
export type MarksRead = Readonly<Record<string, number>>;

/**
 * New to the person: an agent has the last word in a thread that is not
 * resolved (an answer to their mark, or an agent's question), and they have
 * not opened it since that word was added. A resolved thread is a record,
 * never new.
 */
export function isMarkUnread(mark: Mark, read: MarksRead = {}): boolean {
  if (mark.status === "resolved" || lastWordOf(mark) !== "agent") return false;
  const seen = read[mark.id];
  return typeof seen !== "number" || seen < (mark.replies?.length ?? 0);
}

export function unreadMarks(marks: readonly Mark[], read: MarksRead = {}): Mark[] {
  return marks.filter((m) => isMarkUnread(m, read));
}

/** The record after the person opened `mark`'s thread as it stands now. */
export function withMarkRead(read: MarksRead, mark: Pick<Mark, "id" | "replies">): MarksRead {
  return { ...read, [mark.id]: mark.replies?.length ?? 0 };
}

/**
 * What a marks button shows. `forYou`, the main number: what waits on the
 * person (answered marks, an agent's open questions). `forAgent`, the quiet
 * one: what waits on an agent. `unread`: threads with an agent's word not yet
 * opened. An agent's answer moves a mark from `forAgent` to `forYou`.
 */
export function markCounts(marks: readonly Mark[], read: MarksRead = {}): { forYou: number; forAgent: number; unread: number } {
  return {
    forYou: marksWaitingOn(marks, "person").length,
    forAgent: marksWaitingOn(marks, "agent").length,
    unread: unreadMarks(marks, read).length,
  };
}

/** An agent's word that a `marks:changed` carries: an answer in a thread, or a question pinned. */
export interface AgentWord {
  action: "reply" | "add";
  mark: Mark;
  /** Its number on the board. */
  number: number;
  /** The agent's name as it signed. */
  name: string;
}

/**
 * The agent's word in a `marks:changed`, or null: a `reply` whose last word is
 * an agent's (`smcx marks reply`, `answer_mark` with text), or an `add` by an
 * agent (`add_mark`). A person's reply, a resolve, a removal: null.
 */
export function agentWordIn(env: Pick<MarksEnvelope, "marks" | "change">): AgentWord | null {
  const change = env.change;
  if (!change || (change.action !== "reply" && change.action !== "add") || !Array.isArray(env.marks)) return null;
  const i = env.marks.findIndex((m) => m && m.id === change.id);
  if (i < 0) return null;
  const mark = env.marks[i];
  if (change.action === "add") {
    return mark.author?.role === "agent" ? { action: "add", mark, number: i + 1, name: mark.author.name || "the agent" } : null;
  }
  const last = mark.replies?.[mark.replies.length - 1];
  if (!last || last.author?.role !== "agent") return null;
  return { action: "reply", mark, number: i + 1, name: last.author.name || "the agent" };
}

/** One line for a notice: `Mia answered mark 3`, `Mia asked about mark 4`. */
export function agentWordText(word: Pick<AgentWord, "action" | "number" | "name">): string {
  return word.action === "reply" ? `${word.name} answered mark ${word.number}` : `${word.name} asked about mark ${word.number}`;
}

/** What a mark points at, in a few words: `state:Pending, state:Active` or `an area` or `the drawing`. */
export function markAnchorText(mark: Pick<Mark, "elements" | "region" | "level">): string {
  const parts: string[] = [];
  if (mark.elements?.length) parts.push(mark.elements.join(", "));
  if (mark.region) {
    const r = mark.region;
    parts.push(`the area ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}${mark.level ? ` inside ${mark.level}` : ""}`);
  }
  return parts.length ? parts.join(" in ") : "the drawing";
}
