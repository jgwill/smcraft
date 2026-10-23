/**
 * The stage and the marks (Spec 83): how an agent shows its work on the
 * canvas, and how a person points back at it.
 *
 * Two directions over the same drawings:
 *
 * - **The stage** (agent → person). A step names a drawing, what to light in
 *   it — one element to select, several to spotlight, an area to frame — and
 *   the words the agent says there. Steps go out one at a time while the agent
 *   talks (`stage:step`), or as a whole tour the canvas plays back with its own
 *   controls (`stage:load`). A tour is a file (`.tour.json`) so a walkthrough
 *   prepared once can be played again by the next person or the next instance.
 *
 * - **The marks** (person → agent, and back). A mark points at elements or an
 *   area of one drawing and says something about them. It is the context a
 *   person gives before replying: "this state, these two messages — why does
 *   the walk stop here?" Marks are kept beside the drawing they are on, in a
 *   sidecar file (`wave.smdf.json` → `wave.smdf.marks.json`), never inside it:
 *   a drawing says what is being built, its marks say what people and agents
 *   said about it. An agent answers a mark with a reply, and the thread stays
 *   where it was raised.
 *
 * Neither ever changes a drawing. What is shown is a view (Spec 82, D7); what
 * is said about it is a conversation.
 */
import type { Box } from "../viewport.js";

// ─── Files ───────────────────────────────────────────────────────────

export const TOUR_EXTENSION = ".tour.json";
export const MARKS_EXTENSION = ".marks.json";

export function isTourPath(path: string): boolean {
  return path.toLowerCase().endsWith(TOUR_EXTENSION);
}

export function isMarksPath(path: string): boolean {
  return path.toLowerCase().endsWith(MARKS_EXTENSION);
}

/**
 * The sidecar that holds a drawing's marks, beside it: the drawing's own name
 * with `.marks` before `.json`, so `wave.smdf.json` and `wave.erdf.json` never
 * share one.
 */
export function marksPathOf(docPath: string): string {
  if (isMarksPath(docPath)) return docPath;
  return /\.json$/i.test(docPath) ? docPath.replace(/\.json$/i, MARKS_EXTENSION) : `${docPath}${MARKS_EXTENSION}`;
}

/** The drawing a sidecar belongs to. */
export function docPathOfMarks(marksPath: string): string {
  return isMarksPath(marksPath) ? marksPath.slice(0, -MARKS_EXTENSION.length) + ".json" : marksPath;
}

/** Files that belong to the loom but are not drawings, and so never open as one. */
export function isLoomSidecar(path: string): boolean {
  return isTourPath(path) || isMarksPath(path);
}

// ─── The stage ───────────────────────────────────────────────────────

/** One thing the agent shows and says. */
export interface TourStep {
  /** The drawing to open: relative to the tour file, or absolute. Absent: whatever is open stays. */
  doc?: string;
  /** Open the drawing as a member of this system (`.sysdf.json`), so the strip stays. */
  system?: string;
  /** One element to select and bring to the middle: `<kind>:<name>` (`state:Pending`, `message:9`). */
  focus?: string;
  /** Elements to light while the rest of the drawing dims. The view fits them all. */
  spotlight?: string[];
  /** An area of the drawing, in the drawing's own coordinates. The view fits it and frames it. */
  region?: Box;
  /** A few words over the caption. */
  title?: string;
  /** What the agent says at this step. Shown as the caption; read aloud when the person turns the canvas's voice on. */
  say: string;
  /**
   * A recording of `say` to play instead of the canvas's own voice: an
   * `http(s)` URL or a path on the canvas's server. An agent that has a voice
   * of its own (the `miadi-voice` MCP) renders the words there and puts the
   * recording here, so the step is heard in that voice.
   */
  audio?: string;
  /** How long the step stays when it is not spoken, in ms. Absent: estimated from the words. */
  holdMs?: number;
}

export interface TourSettings {
  namespace: string;
  name: string;
  description?: string;
  /** Why this tour was made, for whoever plays it next. */
  notes?: string;
  /** Who prepared it (`agent`, a person's name). */
  author?: string;
}

/** A walkthrough prepared once and played again: `<name>.tour.json`. */
export interface TourDefinition {
  settings: TourSettings;
  steps: TourStep[];
}

export function isTourDefinition(doc: unknown): doc is TourDefinition {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return Array.isArray(d.steps) && !("state" in d) && !("entities" in d) && !("participants" in d) && !("members" in d);
}

export function emptyTour(namespace: string, name: string, description?: string): TourDefinition {
  return { settings: description ? { namespace, name, description } : { namespace, name }, steps: [] };
}

/** A stage is a named channel between the agents and the canvases that present on it. */
export const DEFAULT_STAGE = "default";
const STAGE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export function isStageName(name: unknown): name is string {
  return typeof name === "string" && STAGE_NAME.test(name);
}

/** The hub room of a stage. Never a file path, so it never collides with a drawing's room. */
export function stageRoom(name: string): string {
  return `stage:${isStageName(name) ? name : DEFAULT_STAGE}`;
}

// ─── The marks ───────────────────────────────────────────────────────

/**
 * What a mark asks for. The first three are `@miadi/annotate-core`'s, so a
 * review of a drawing and a review of a reply read alike: `comment`,
 * `looks_good`, `delete` (this element should go). `question` is what an agent
 * leaves for a person to answer.
 */
export type MarkKind = "comment" | "question" | "looks_good" | "delete";
export const MARK_KINDS: readonly MarkKind[] = ["comment", "question", "looks_good", "delete"];

export type MarkRole = "person" | "agent";

/** Who said it. `id` is stable and filterable, `name` is what a reader sees. */
export interface MarkAuthor {
  id: string;
  name: string;
  role: MarkRole;
}

export interface MarkReply {
  author: MarkAuthor;
  text: string;
  at: string;
}

/**
 * `open` waits for the other side; `answered` was replied to by the other side
 * (an agent answered a person, or a person answered an agent's question);
 * `resolved` was closed by someone, and stays in the file as a record.
 */
export type MarkStatus = "open" | "answered" | "resolved";
export const MARK_STATUSES: readonly MarkStatus[] = ["open", "answered", "resolved"];

export interface Mark {
  id: string;
  kind: MarkKind;
  /** The elements pointed at, as focus strings. */
  elements?: string[];
  /** The area pointed at, in the drawing's coordinates. */
  region?: Box;
  /**
   * The state designer draws one level at a time: the state whose children
   * were on the board when the area was drawn. Absent: the root.
   */
  level?: string;
  text: string;
  author: MarkAuthor;
  at: string;
  status: MarkStatus;
  replies?: MarkReply[];
}

/** The sidecar beside a drawing. `doc` is the drawing's file name, for a reader of the file. */
export interface MarksFile {
  doc: string;
  marks: Mark[];
}

/** What a caller gives to make a mark; the rest is stamped. */
export interface MarkInput {
  kind?: MarkKind;
  elements?: string[];
  region?: Box;
  level?: string;
  text: string;
  author: MarkAuthor;
}

// ─── The wire ────────────────────────────────────────────────────────

/** One step, live. Paths in it are absolute: a canvas opens them as they are. */
export interface StageStepEnvelope {
  stage: string;
  step: TourStep;
  /** Its place in a tour, when it is part of one. */
  index?: number;
  count?: number;
  /** The tour file it came from. */
  tour?: string;
  /** The tour's name, for the caption. */
  title?: string;
  origin: string;
  at?: string;
}

/** A whole tour handed to the canvases to play with their own controls. */
export interface StageLoadEnvelope {
  stage: string;
  tour: TourDefinition;
  /** The tour file, when it is one. */
  path?: string;
  /** The step to start at (0-based). Default 0. */
  from?: number;
  /** Start playing at once. Default true. */
  autoplay?: boolean;
  origin: string;
  at?: string;
}

export type StageAction = "play" | "pause" | "next" | "prev" | "goto" | "stop";
export const STAGE_ACTIONS: readonly StageAction[] = ["play", "pause", "next", "prev", "goto", "stop"];

export interface StageControlEnvelope {
  stage: string;
  action: StageAction;
  /** For `goto`: the step (0-based). */
  index?: number;
  origin: string;
}

/**
 * What a person is looking at, as their canvas reports it to the stage: the
 * drawing, the element in hand, the part of the drawing on screen, and where a
 * tour stands. Kept by the hub in memory, as presence is — it answers "what is
 * the person looking at right now", not "what did they say" (that is a mark).
 */
export interface StageContext {
  stage: string;
  doc?: string;
  kind?: "machine" | "erd" | "sequence" | "system";
  system?: string;
  focus?: string | null;
  /** The part of the drawing on screen, in its coordinates. */
  visible?: Box;
  tour?: { path?: string; title?: string; index: number; count: number; playing: boolean };
  /** Who is looking (the page's name for itself). */
  who?: string;
  at: string;
}

/** What the hub remembers of a stage, handed to whoever joins it. */
export interface StageState {
  stage: string;
  step?: StageStepEnvelope;
  tour?: StageLoadEnvelope;
  context?: StageContext;
}

export type MarksChange = "add" | "reply" | "resolve" | "reopen" | "remove";

/**
 * A drawing's marks changed. Sent to the drawing's own room by whoever wrote
 * the sidecar (durable first, as every edit), and to a stage so an agent
 * waiting there hears it at once. The whole list travels: it is short.
 */
export interface MarksEnvelope {
  docId: string;
  marks: Mark[];
  change?: { action: MarksChange; id: string };
  /** The stage to tell as well. */
  stage?: string;
  origin: string;
}
