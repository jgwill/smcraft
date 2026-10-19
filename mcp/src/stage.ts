/**
 * The stage and the marks in the MCP server (Spec 83).
 *
 * An agent shows its work on the canvases a person has open:
 *
 * - `show_step`     one step now, while it talks: open a drawing, light some
 *                   of it, say a sentence beside it.
 * - `write_tour`    a walkthrough as a file (`.tour.json`), so it can be
 *                   played again — by the person later, by the next instance.
 * - `play_tour`     hand a tour to the canvases; they play it with their own
 *                   controls (and voice, when the person turned it on).
 * - `stage_control` play, pause, next, prev, goto, stop.
 *
 * And hears what the person points at:
 *
 * - `read_marks`    what is on the person's screen, and the marks waiting —
 *                   each says which elements of which drawing it is about.
 *                   Read it before replying to the person.
 * - `await_marks`   wait for the person's next mark or reply.
 * - `answer_mark`   reply in a mark's thread (and show what it is about).
 * - `add_mark`      leave a question on an element for the person.
 *
 * Marks live beside the drawing they are on (`<drawing>.marks.json`); this
 * server writes the sidecar first and tells the hub after, as every edit.
 * Nothing here changes a drawing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import {
  MARK_KINDS,
  STAGE_ACTIONS,
  addMark,
  formatContext,
  formatReview,
  isStageName,
  isSysdfPath,
  isTourDefinition,
  isTourPath,
  marksPathOf,
  marksWaitingOn,
  markAnchorText,
  readMarksFile,
  relativeMemberPath,
  replyToMark,
  resolveMark,
  resolveMemberPath,
  resolveStepPaths,
  resolveTourPaths,
  summarizeTour,
  validateStep,
  validateTour,
  type DocMarks,
  type Mark,
  type MarkAuthor,
  type MarkKind,
  type MarksFile,
  type StageAction,
  type StageContext,
  type TourDefinition,
  type TourStep,
} from "@miadi/stateloom-protocol";
import { writeFileAtomic } from "./atomicWrite.js";
import { readSystem } from "./system.js";
import type { Live } from "./live.js";

export interface StageHost {
  /** The active document's absolute path. */
  projectFile(): string;
  outsideRoot(path: string): string | undefined;
  live: Live;
  /** STATELOOM_STAGE, else `default`. */
  stageName(): string;
  /** Who this agent is on a mark: STATELOOM_AGENT_NAME, else `agent`. */
  agent(): MarkAuthor;
  /** The system this server last created, set or checked. */
  lastSystem(): string | undefined;
  /** A canvas link for a drawing, for the person. */
  canvasUrl(doc: string): string;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ─── Disk ────────────────────────────────────────────────────────────

function readMarks(doc: string): MarksFile {
  const path = marksPathOf(doc);
  if (!existsSync(path)) return { doc: basename(doc), marks: [] };
  return readMarksFile(JSON.parse(readFileSync(path, "utf8")), basename(doc));
}

function marksMtime(doc: string): number {
  try {
    return statSync(marksPathOf(doc)).mtimeMs;
  } catch {
    return 0;
  }
}

function writeMarks(doc: string, file: MarksFile): void {
  writeFileAtomic(marksPathOf(doc), JSON.stringify(file, null, 2) + "\n");
}

function readTour(path: string): TourDefinition {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!isTourDefinition(parsed)) throw new Error(`${path} is not a tour (no steps).`);
  return parsed;
}

function slug(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "tour";
}

// ─── Which drawings ──────────────────────────────────────────────────

/**
 * The drawings a question about marks is about: the one named; else the active
 * document, and — when it is a system, or a member of the last system — every
 * member of that system.
 */
function scopeDocs(host: StageHost, args: { doc?: string; system?: string }): string[] | { error: string } {
  const out: string[] = [];
  const add = (p: string) => {
    const abs = resolve(p);
    if (!out.includes(abs)) out.push(abs);
  };
  if (args.doc) {
    const abs = resolve(args.doc);
    const denial = host.outsideRoot(abs);
    if (denial) return { error: denial };
    add(abs);
    return out;
  }
  const active = host.projectFile();
  const systems = [args.system, isSysdfPath(active) ? active : undefined, host.lastSystem()].filter((s): s is string => !!s);
  for (const sys of systems) {
    const abs = resolve(sys);
    if (host.outsideRoot(abs)) continue;
    const def = readSystem(abs);
    if (!def) continue;
    const members = def.members.map((m) => resolveMemberPath(abs, m.path));
    // A remembered system counts only when it is the one the active document belongs to.
    if (!args.system && abs !== active && !members.includes(active)) continue;
    if (!isSysdfPath(active)) add(active);
    for (const m of members) if (!host.outsideRoot(m)) add(m);
    return out;
  }
  add(active);
  return out;
}

/** The system a step's drawing belongs to: the one named, else the active or last one that lists it. */
function systemFor(host: StageHost, doc: string, named?: string): string | undefined {
  if (named) return resolve(named);
  const active = host.projectFile();
  for (const sys of [isSysdfPath(active) ? active : undefined, host.lastSystem()]) {
    if (!sys) continue;
    const def = readSystem(sys);
    if (def?.members.some((m) => resolveMemberPath(sys, m.path) === doc)) return sys;
  }
  // A system kept beside the drawing that lists it: the strip of its siblings stays on screen.
  try {
    for (const name of readdirSync(dirname(doc)).filter((f) => isSysdfPath(f)).sort()) {
      const sys = join(dirname(doc), name);
      if (readSystem(sys)?.members.some((m) => resolveMemberPath(sys, m.path) === doc)) return sys;
    }
  } catch {
    // No folder to read: the step opens the drawing alone.
  }
  return undefined;
}

// ─── Arguments ───────────────────────────────────────────────────────

const box = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const stageArg = z.string().optional().describe("The stage to present on; default STATELOOM_STAGE, else 'default'");

const stepShape = {
  say: z.string().describe("What you say at this step — one or two sentences, shown as the caption (read aloud when the person turns the voice on)"),
  doc: z.string().optional().describe("The drawing to open: absolute, or relative to the active document's folder. Default: the active document"),
  focus: z.string().optional().describe("One element to select and centre: <kind>:<name>, kind one of entity, attribute, machine, object, event, state, participant, message ('state:Pending', 'message:9', 'attribute:Order.status')"),
  spotlight: z.array(z.string()).optional().describe("Elements to light while the rest of the drawing dims; the view fits them all. Same <kind>:<name> as focus"),
  region: box.optional().describe("An area of the drawing, in its own coordinates, to frame and fit"),
  title: z.string().optional().describe("A few words over the caption"),
  system: z.string().optional().describe("Open the drawing as a member of this .sysdf.json, so the system strip stays. Default: the active or last system that lists the drawing"),
  audio: z.string().optional().describe("A recording of `say` (an http(s) URL, or a path on the canvas's server) to play instead of the canvas's own voice — e.g. what the miadi-voice MCP rendered"),
  holdMs: z.number().optional().describe("How long the step stays during play when it is not heard, in ms. Default: from the words"),
};

const tourStepShape = z.object({
  ...stepShape,
  doc: z.string().optional().describe("The drawing: absolute, or relative to the active document's folder (stored relative to the tour file). Absent: the previous step's drawing"),
});

// ─── The tools ───────────────────────────────────────────────────────

export function registerStageTools(server: McpServer, host: StageHost): void {
  let lastTour: string | undefined;
  const stageOf = (arg?: string): string | { error: string } => {
    const name = arg ?? host.stageName();
    return isStageName(name) ? name : { error: `A stage name is letters, digits, '.', '_' or '-' (got '${name}').` };
  };
  const live = host.live;
  const notLive = "not live: this server's bridge has no stage support";

  server.tool(
    "show_step",
    "Show the person one step on the canvas while you talk (Spec 83): open a drawing, light part of it, and say a sentence beside it. Use it to point at what you mean instead of describing it — the canvas opens the drawing, selects `focus`, dims everything but `spotlight`, frames `region`, and shows `say` as a caption (spoken aloud when the person turned the voice on). A step changes no document. A tour that was playing pauses under it. The person answers by marking what they see; read_marks reads it.",
    { ...stepShape, stage: stageArg },
    async ({ stage, ...given }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      const active = host.projectFile();
      const doc = given.doc ? resolve(dirname(active), given.doc) : active;
      const denial = host.outsideRoot(doc);
      if (denial) return fail(denial);
      const step: TourStep = { ...given, doc };
      const system = systemFor(host, doc, given.system ? resolve(dirname(active), given.system) : undefined);
      if (system) step.system = system;
      const problems = validateStep(step);
      if (problems.length) return fail(problems.map((p) => `${p.ruleId} ${p.message}`).join("\n"));
      const missing = existsSync(doc) ? "" : ` (no file at ${doc} yet — the canvas will show it empty)`;
      if (!live.step) return fail(notLive);
      const sent = await live.step({ stage: st, step });
      const what = [basename(doc), step.focus, step.spotlight?.length ? `lighting ${step.spotlight.join(", ")}` : "", step.region ? "framing an area" : ""]
        .filter(Boolean)
        .join(" · ");
      return sent.ok
        ? ok(`On stage '${st}': ${what}${missing}. ${sent.text}. The person sees it at ${host.canvasUrl(doc)}.`)
        : fail(`Could not show ${what} on stage '${st}': ${sent.text}.`);
    },
  );

  server.tool(
    "write_tour",
    "Write a walkthrough as a file (<name>.tour.json, Spec 83): an ordered list of steps — each a drawing, what to light in it, and what to say — that the canvas plays back with its own controls, like slides over the real drawings. Prepare one when the work needs explaining in an order, when the person will review it later, or when an unfinished session hands its design on. Step `doc` paths are given absolute or relative to the active document's folder, and stored relative to the tour file; a step without `doc` stays on the previous step's drawing. Without `path` the tour lands beside the active document. Checked T001–T009; play it with play_tour.",
    {
      name: z.string(),
      namespace: z.string().optional(),
      description: z.string().optional(),
      notes: z.string().optional().describe("Why this tour exists, for whoever plays it next"),
      steps: z.array(tourStepShape).min(1),
      path: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
    async ({ name, namespace, description, notes, steps, path, overwrite }) => {
      const active = host.projectFile();
      const target = resolve(dirname(active), path ?? `${slug(name)}.tour.json`);
      if (!isTourPath(target)) return fail(`A tour file ends in .tour.json (got '${target}').`);
      const denial = host.outsideRoot(target);
      if (denial) return fail(denial);
      if (existsSync(target) && !overwrite) {
        return fail(`${target} already exists. Pass overwrite: true to replace it, or another path.`);
      }
      // Paths as the caller gave them are relative to the active document's
      // folder; stored relative to the tour file (they share a folder unless
      // `path` says otherwise).
      const stored: TourStep[] = steps.map((s) => {
        const abs = s.doc ? resolve(dirname(active), s.doc) : undefined;
        const sys = s.system ? resolve(dirname(active), s.system) : undefined;
        const { doc: _d, system: _s, ...rest } = s;
        return {
          ...rest,
          ...(abs ? { doc: relativeMemberPath(target, abs) } : {}),
          ...(sys ? { system: relativeMemberPath(target, sys) } : {}),
        };
      });
      const def: TourDefinition = {
        settings: {
          namespace: namespace ?? "",
          name,
          ...(description ? { description } : {}),
          ...(notes ? { notes } : {}),
          author: host.agent().name,
        },
        steps: stored,
      };
      const problems = validateTour(def);
      if (problems.length) return fail(problems.map((p) => `${p.ruleId}${p.step !== undefined ? ` step ${p.step + 1}` : ""}: ${p.message}`).join("\n"));
      const absent = resolveTourPaths(def, target)
        .steps.map((s, i) => (s.doc && !existsSync(s.doc) ? `step ${i + 1}: no file at ${s.doc}` : ""))
        .filter(Boolean);
      for (const s of resolveTourPaths(def, target).steps) {
        if (s.doc && host.outsideRoot(s.doc)) return fail(host.outsideRoot(s.doc)!);
      }
      writeFileAtomic(target, JSON.stringify(def, null, 2) + "\n");
      lastTour = target;
      return ok(`Wrote ${target}.\n${summarizeTour(def)}${absent.length ? `\nNot there yet: ${absent.join("; ")}.` : ""}\nPlay it with play_tour.`);
    },
  );

  server.tool(
    "play_tour",
    "Hand a tour (.tour.json) to the canvases on the stage (Spec 83). They open each step's drawing, light it, show the words, and move on by themselves when `autoplay` (default true) — or wait for the person's ▶. The person can step back and forth; stage_control moves it from here. With no `tour`: the one this server wrote last, else the only .tour.json beside the active document.",
    {
      tour: z.string().optional(),
      from: z.number().int().min(1).optional().describe("The step to start at, counted from 1"),
      autoplay: z.boolean().optional(),
      stage: stageArg,
    },
    async ({ tour, from, autoplay, stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      const active = host.projectFile();
      let path = tour ? resolve(dirname(active), tour) : lastTour;
      if (!path) {
        const beside = readdirSync(dirname(active)).filter((f) => isTourPath(f));
        if (beside.length === 1) path = join(dirname(active), beside[0]);
        else return fail(beside.length ? `Several tours beside ${basename(active)}: ${beside.join(", ")}. Name one with tour:.` : `No tour given and none beside ${basename(active)}. Write one with write_tour.`);
      }
      const denial = host.outsideRoot(path);
      if (denial) return fail(denial);
      let def: TourDefinition;
      try {
        def = readTour(path);
      } catch (e) {
        return fail(message(e));
      }
      const problems = validateTour(def);
      if (problems.length) return fail(`${path} does not check:\n` + problems.map((p) => `${p.ruleId}${p.step !== undefined ? ` step ${p.step + 1}` : ""}: ${p.message}`).join("\n"));
      if (!live.load) return fail(notLive);
      const start = Math.min(def.steps.length, from ?? 1) - 1;
      // Each drawing opens inside the system that lists it, so its siblings stay in reach.
      const resolved = resolveTourPaths(def, path);
      const placed = {
        ...resolved,
        steps: resolved.steps.map((s) => {
          if (s.system || !s.doc) return s;
          const system = systemFor(host, s.doc);
          return system ? { ...s, system } : s;
        }),
      };
      const sent = await live.load({ stage: st, tour: placed, path, from: start, autoplay: autoplay !== false });
      lastTour = path;
      return sent.ok
        ? ok(`Playing '${def.settings.name}' (${def.steps.length} steps) on stage '${st}' from step ${start + 1}${autoplay === false ? ", paused" : ""}: ${sent.text}.`)
        : fail(`Could not play ${path}: ${sent.text}.`);
    },
  );

  server.tool(
    "stage_control",
    `Move what the canvases on the stage are playing: ${STAGE_ACTIONS.join(", ")}. goto takes index, counted from 1. stop puts the tour away and clears the caption.`,
    {
      action: z.enum(STAGE_ACTIONS as [StageAction, ...StageAction[]]),
      index: z.number().int().min(1).optional(),
      stage: stageArg,
    },
    async ({ action, index, stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      if (action === "goto" && index === undefined) return fail("goto needs index (counted from 1).");
      if (!live.control) return fail(notLive);
      const sent = await live.control({ stage: st, action, ...(index !== undefined ? { index: index - 1 } : {}) });
      return sent.ok ? ok(`${action}${index ? ` ${index}` : ""} on stage '${st}': ${sent.text}.`) : fail(`Could not ${action}: ${sent.text}.`);
    },
  );

  async function contextOf(stage: string): Promise<{ ctx: StageContext | null; note: string }> {
    if (!live.stageState) return { ctx: null, note: "" };
    const r = await live.stageState(stage);
    if (!r.ok) return { ctx: null, note: ` (what is on screen is unknown: ${r.text})` };
    return { ctx: r.state?.context ?? null, note: "" };
  }

  function gather(docs: string[], all: boolean): { entries: DocMarks[]; errors: string[] } {
    const entries: DocMarks[] = [];
    const errors: string[] = [];
    for (const doc of docs) {
      try {
        const file = readMarks(doc);
        const marks = all ? file.marks : marksWaitingOn(file.marks, "agent");
        if (marks.length) entries.push({ doc, marks });
      } catch (e) {
        errors.push(`${marksPathOf(doc)}: ${message(e)}`);
      }
    }
    return { entries, errors };
  }

  server.tool(
    "read_marks",
    "What the person is pointing at (Spec 83): what their canvas shows right now (drawing, element in hand, tour step), then the marks waiting for you — each a note on some elements or an area of a drawing, with its thread. Read it before you reply to the person: their words are about what they marked. Default scope: the active document and, when it is a system or a member of one, every member. all: true lists every mark, answered and resolved too. Answer with answer_mark.",
    { doc: z.string().optional(), system: z.string().optional(), all: z.boolean().optional(), stage: stageArg },
    async ({ doc, system, all, stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      const docs = scopeDocs(host, { doc, system });
      if (!Array.isArray(docs)) return fail(docs.error);
      const { ctx, note } = await contextOf(st);
      const { entries, errors } = gather(docs, !!all);
      const scope = docs.length === 1 ? basename(docs[0]) : `${docs.length} drawings (${docs.map((d) => basename(d)).join(", ")})`;
      const text =
        formatReview(ctx, entries) +
        note +
        `\nScope: ${scope}${all ? ", every mark" : ", marks waiting for you"}.` +
        (entries.length ? `\nDrawings: ${entries.map((e) => e.doc).join(", ")}` : "") +
        (errors.length ? `\nUnreadable: ${errors.join("; ")}` : "");
      return ok(text);
    },
  );

  server.tool(
    "await_marks",
    "Wait for the person to mark something or reply in a thread (Spec 83), then return what they said with what is on their screen. Use it after showing work when the next move is theirs. Returns at the first new mark or reply waiting for you in scope (as read_marks), or after timeoutSeconds (default 120, at most 600) with what is waiting already. For a session that must wake on a person's mark without holding a tool call, run `smcx marks await` as a background task instead.",
    { timeoutSeconds: z.number().min(1).max(600).optional(), doc: z.string().optional(), system: z.string().optional(), stage: stageArg },
    async ({ timeoutSeconds, doc, system, stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      const docs = scopeDocs(host, { doc, system });
      if (!Array.isArray(docs)) return fail(docs.error);
      const seen = new Map<string, string>();
      const keyOf = (m: Mark) => `${m.id}:${m.replies?.length ?? 0}:${m.status}`;
      for (const { doc: d, marks } of gather(docs, false).entries) for (const m of marks) seen.set(`${d}#${m.id}`, keyOf(m));
      const mtimes = new Map(docs.map((d) => [d, marksMtime(d)]));
      const deadline = Date.now() + (timeoutSeconds ?? 120) * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const changed = docs.filter((d) => marksMtime(d) !== mtimes.get(d));
        if (!changed.length) continue;
        for (const d of changed) mtimes.set(d, marksMtime(d));
        const fresh: DocMarks[] = [];
        for (const { doc: d, marks } of gather(changed, false).entries) {
          const news = marks.filter((m) => seen.get(`${d}#${m.id}`) !== keyOf(m));
          if (news.length) fresh.push({ doc: d, marks: news });
        }
        if (fresh.length) {
          const { ctx } = await contextOf(st);
          return ok(`The person marked something.\n${formatReview(ctx, fresh)}\nAnswer with answer_mark (id, text); show_step points at what you mean.`);
        }
      }
      const { ctx, note } = await contextOf(st);
      const waiting = gather(docs, false).entries;
      return ok(`No new mark in ${timeoutSeconds ?? 120}s.${note}\n${formatReview(ctx, waiting)}`);
    },
  );

  /** Find a mark by id in the scope; the drawing it is on. */
  function findMark(id: string, docs: string[]): { doc: string; file: MarksFile; mark: Mark } | null {
    for (const d of docs) {
      try {
        const file = readMarks(d);
        const mark = file.marks.find((m) => m.id === id);
        if (mark) return { doc: d, file, mark };
      } catch {
        // An unreadable sidecar holds no mark to answer.
      }
    }
    return null;
  }

  server.tool(
    "answer_mark",
    "Reply in a mark's thread (Spec 83): the person sees your words under their note, on the drawing, and the mark is answered. resolve: true closes it (text may then be empty). show: true also puts the mark's elements on stage with your words as the caption, so the person sees what you mean while they read it. `id` is the mark's id from read_marks (m-…).",
    {
      id: z.string(),
      text: z.string().optional(),
      resolve: z.boolean().optional(),
      show: z.boolean().optional(),
      doc: z.string().optional(),
      system: z.string().optional(),
      stage: stageArg,
    },
    async ({ id, text, resolve: close, show, doc, system, stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      if (!text?.trim() && !close) return fail("Say something (text), or pass resolve: true to close the mark.");
      const docs = scopeDocs(host, { doc, system });
      if (!Array.isArray(docs)) return fail(docs.error);
      const found = findMark(id, docs);
      if (!found) return fail(`No mark '${id}' in ${docs.map((d) => basename(d)).join(", ")}. read_marks lists them (all: true for answered ones).`);
      const at = new Date().toISOString();
      let next = found.file;
      try {
        if (text?.trim()) next = replyToMark(next, id, { author: host.agent(), text }, at);
        if (close) next = resolveMark(next, id);
      } catch (e) {
        return fail(message(e));
      }
      const denial = host.outsideRoot(marksPathOf(found.doc));
      if (denial) return fail(denial);
      writeMarks(found.doc, next);
      const mark = next.marks.find((m) => m.id === id)!;
      const told = live.marks
        ? await live.marks({ docId: found.doc, marks: next.marks, change: { action: text?.trim() ? "reply" : "resolve", id }, stage: st })
        : { ok: false, text: notLive };
      let shown = "";
      if (show && text?.trim() && live.step) {
        const step: TourStep = resolveStepPaths(
          {
            doc: found.doc,
            say: text,
            title: `Re: ${mark.text.slice(0, 60)}`,
            ...(mark.elements?.length ? { spotlight: mark.elements } : {}),
            ...(mark.region ? { region: mark.region } : {}),
          },
          found.doc,
        );
        const sys = systemFor(host, found.doc);
        if (sys) step.system = sys;
        const r = await live.step({ stage: st, step });
        shown = r.ok ? " Shown on stage." : ` Not shown: ${r.text}.`;
      }
      return ok(`${text?.trim() ? "Answered" : "Resolved"} ${id} on ${basename(found.doc)} (${markAnchorText(mark)}), now ${mark.status}. Canvas: ${told.ok ? told.text : `not told live (${told.text}); it reads the sidecar on its next look`}.${shown}`);
    },
  );

  server.tool(
    "add_mark",
    `Leave a mark for the person on some elements or an area of a drawing (Spec 83) — a question you need them to answer, a decision to confirm, a thing to look at — pinned where it applies. kind is one of ${MARK_KINDS.join(", ")} (default question). Their reply arrives in the thread; await_marks waits for it.`,
    {
      text: z.string(),
      elements: z.array(z.string()).optional().describe("<kind>:<name> of each element it is about"),
      region: box.optional(),
      kind: z.enum(MARK_KINDS as [MarkKind, ...MarkKind[]]).optional(),
      doc: z.string().optional(),
      stage: stageArg,
    },
    async ({ text, elements, region, kind, doc, stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      const active = host.projectFile();
      const target = doc ? resolve(dirname(active), doc) : active;
      const denial = host.outsideRoot(target) ?? host.outsideRoot(marksPathOf(target));
      if (denial) return fail(denial);
      let next: MarksFile;
      try {
        next = addMark(readMarks(target), { text, elements, region, kind: kind ?? "question", author: host.agent() }, new Date().toISOString());
      } catch (e) {
        return fail(message(e));
      }
      writeMarks(target, next);
      const mark = next.marks[next.marks.length - 1];
      const told = live.marks
        ? await live.marks({ docId: target, marks: next.marks, change: { action: "add", id: mark.id }, stage: st })
        : { ok: false, text: notLive };
      return ok(`Marked ${markAnchorText(mark)} on ${basename(target)} as ${mark.kind} (${mark.id}). Canvas: ${told.ok ? told.text : `not told live (${told.text})`}.`);
    },
  );

  // Present for agents that ask what the person sees without wanting the marks.
  server.tool(
    "what_is_on_screen",
    "What the person's canvas on the stage shows right now: the drawing, the element in hand, the visible area, where a tour stands (Spec 83). One line; read_marks adds the marks.",
    { stage: stageArg },
    async ({ stage }) => {
      const st = stageOf(stage);
      if (typeof st !== "string") return fail(st.error);
      const { ctx, note } = await contextOf(st);
      return ok(formatContext(ctx) + note);
    },
  );
}
