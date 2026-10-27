/**
 * `smcx stage …` and `smcx marks …` (Spec 83) — the stage and the marks from a
 * terminal, for agents whose host has no MCP and for sessions that must wake
 * when the person points at something.
 *
 *   smcx stage show --say "…" [--focus k:n] [--spotlight a,b] [--doc <drawing>]
 *   smcx stage play <tour.json> [--from N] [--paused]
 *   smcx stage control <play|pause|next|prev|goto|stop> [N]
 *   smcx marks                       what is on screen, and the marks waiting
 *   smcx marks await [--timeout S]   exit 0 with the person's next mark; 4 only after a --timeout
 *   smcx marks reply <id> "<text>" [--resolve]
 *
 * `marks await` is the background-task half of a conversation, as
 * `mia-listen await` is for a spoken take: a session runs it in the
 * background, and its exit wakes the session with what the person marked and
 * the exact commands to answer and to listen again.
 *
 * The scope of `marks` is the project file and, when it is a system, every
 * member. The sidecar is written first and the hub told after.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createBridgeClient } from "@miadi/stateloom-client";
import {
  DEFAULT_STAGE,
  STAGE_ACTIONS,
  envAlias,
  formatReview,
  isStageName,
  isSysdfPath,
  isTourDefinition,
  marksPathOf,
  marksWaitingOn,
  readMarksFile,
  replyToMark,
  resolveMark,
  resolveMemberPath,
  resolveTourPaths,
  validateStep,
  validateTour,
  type DocMarks,
  type Mark,
  type MarksFile,
  type StageAction,
  type StageContext,
  type StageState,
  type TourStep,
} from "@miadi/stateloom-protocol";

export interface StageCtx {
  doc: string;
  bridgeUrl?: string;
  name?: string;
  stage?: string;
  token?: string;
}

const out = (s: string): void => {
  process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
};

function stageName(c: StageCtx): string {
  const name = c.stage || envAlias("STAGE") || DEFAULT_STAGE;
  if (!isStageName(name)) throw new Error(`not a stage name: ${name}`);
  return name;
}

function agentName(c: StageCtx): string {
  return c.name || envAlias("AGENT_NAME") || "agent";
}

/** The drawings in scope: the project file, or a system's members. */
export function scopeOf(doc: string): string[] {
  const abs = resolve(doc);
  if (!isSysdfPath(abs) || !existsSync(abs)) return [abs];
  try {
    const sys = JSON.parse(readFileSync(abs, "utf8")) as { members?: { path?: string }[] };
    const members = (sys.members ?? []).filter((m) => m?.path).map((m) => resolveMemberPath(abs, m.path!));
    return members.length ? members : [abs];
  } catch {
    return [abs];
  }
}

function readMarks(doc: string): MarksFile {
  const p = marksPathOf(doc);
  if (!existsSync(p)) return { doc: basename(doc), marks: [] };
  return readMarksFile(JSON.parse(readFileSync(p, "utf8")), basename(doc));
}

function mtime(doc: string): number {
  try {
    return statSync(marksPathOf(doc)).mtimeMs;
  } catch {
    return 0;
  }
}

/** What the hub keeps of the stage, by plain HTTP. Null when there is no hub or it will not say. */
export async function stageState(c: StageCtx): Promise<StageState | null> {
  if (!c.bridgeUrl) return null;
  try {
    const token = c.token ?? envAlias("BRIDGE_TOKEN");
    const r = await fetch(`${c.bridgeUrl.replace(/\/$/, "")}/stage/${encodeURIComponent(stageName(c))}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    return r.ok ? ((await r.json()) as StageState) : null;
  } catch {
    return null;
  }
}

function waiting(docs: string[], all = false): DocMarks[] {
  const entries: DocMarks[] = [];
  for (const d of docs) {
    try {
      const file = readMarks(d);
      const marks = all ? file.marks : marksWaitingOn(file.marks, "agent");
      if (marks.length) entries.push({ doc: d, marks });
    } catch (e) {
      process.stderr.write(`${marksPathOf(d)}: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  return entries;
}

/** Send one frame from a short-lived client and leave. Best-effort: the file already stands. */
async function push(c: StageCtx, what: string, send: (client: ReturnType<typeof createBridgeClient>) => Promise<void>): Promise<string> {
  if (!c.bridgeUrl) return `not live: no bridge (--bridge / STATELOOM_BRIDGE_URL)`;
  const client = createBridgeClient({ url: c.bridgeUrl, role: "cli", docId: `stage:${what}`, name: agentName(c), token: c.token ?? envAlias("BRIDGE_TOKEN"), autoResync: false });
  try {
    await Promise.race([send(client), new Promise((_, no) => setTimeout(() => no(new Error("the hub did not answer in 3 s")), 3000))]);
    await new Promise((r) => setTimeout(r, 200));
    return `${what} sent to the hub`;
  } catch (e) {
    return `not live: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    client.disconnect();
  }
}

// ─── marks ───────────────────────────────────────────────────────────

export async function marksList(c: StageCtx, opts: { all?: boolean; json?: boolean }): Promise<void> {
  const docs = scopeOf(c.doc);
  const entries = waiting(docs, opts.all);
  const state = await stageState(c);
  if (opts.json) {
    out(JSON.stringify({ context: state?.context ?? null, docs, marks: entries }, null, 2));
    return;
  }
  out(formatReview(state?.context ?? null, entries));
}

/**
 * Wait for the person's next mark or reply in scope. Exit 0 with the wake text. There is no
 * deadline unless `timeout` names seconds: a wake with nothing new makes the session read its
 * whole context again only to re-arm. Exit 4 when a given timeout runs out.
 */
export async function marksAwait(c: StageCtx, opts: { timeout?: number; interval?: number }): Promise<number> {
  const docs = scopeOf(c.doc);
  const keyOf = (m: Mark) => `${m.id}:${m.replies?.length ?? 0}:${m.status}`;
  const seen = new Set<string>();
  for (const { doc, marks } of waiting(docs)) for (const m of marks) seen.add(`${doc}#${keyOf(m)}`);
  const times = new Map(docs.map((d) => [d, mtime(d)]));
  const deadline = opts.timeout && opts.timeout > 0 ? Date.now() + opts.timeout * 1000 : Infinity;
  const every = opts.interval ?? 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, every));
    const changed = docs.filter((d) => mtime(d) !== times.get(d));
    if (!changed.length) continue;
    for (const d of changed) times.set(d, mtime(d));
    const fresh = waiting(changed)
      .map(({ doc, marks }) => ({ doc, marks: marks.filter((m) => !seen.has(`${doc}#${keyOf(m)}`)) }))
      .filter((e) => e.marks.length);
    if (!fresh.length) continue;
    const state = await stageState(c);
    const first = fresh[0].marks[fresh[0].marks.length - 1];
    const who = first.replies?.length ? first.replies[first.replies.length - 1].author.name : first.author.name;
    const docFlag = `--doc ${JSON.stringify(c.doc)}`;
    out(
      [
        `NEW MARK FROM ${who.toUpperCase()} · ${basename(fresh[0].doc)}`,
        formatReview(state?.context ?? null, fresh),
        "",
        "Answer in the thread (and point at it with show_step, or `smcx stage show`):",
        `  smcx ${docFlag} marks reply ${first.id} "<what you say>"`,
        "Listen again:",
        `  smcx ${docFlag} marks await${opts.timeout ? ` --timeout ${opts.timeout}` : ""}`,
      ].join("\n"),
    );
    return 0;
  }
  out(`no new mark in ${opts.timeout}s — listen again: smcx --doc ${JSON.stringify(c.doc)} marks await`);
  return 4;
}

export async function marksReply(c: StageCtx, id: string, text: string | undefined, opts: { resolve?: boolean }): Promise<void> {
  if (!text?.trim() && !opts.resolve) throw new Error("say something, or pass --resolve");
  for (const doc of scopeOf(c.doc)) {
    let file: MarksFile;
    try {
      file = readMarks(doc);
    } catch {
      continue;
    }
    if (!file.marks.some((m) => m.id === id)) continue;
    const name = agentName(c);
    const at = new Date().toISOString();
    if (text?.trim()) file = replyToMark(file, id, { author: { id: name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"), name, role: "agent" }, text }, at);
    if (opts.resolve) file = resolveMark(file, id);
    const { writeFileSync, renameSync } = await import("node:fs");
    const target = marksPathOf(doc);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
    renameSync(tmp, target);
    const told = await push(c, "marks", (client) =>
      client.emitMarks({ docId: doc, marks: file.marks, change: { action: text?.trim() ? "reply" : "resolve", id }, stage: stageName(c) }),
    );
    out(`${text?.trim() ? "answered" : "resolved"} ${id} on ${basename(doc)} — ${told}`);
    return;
  }
  throw new Error(`no mark '${id}' in ${scopeOf(c.doc).map((d) => basename(d)).join(", ")}`);
}

// ─── stage ───────────────────────────────────────────────────────────

export async function stageShow(
  c: StageCtx,
  opts: { say: string; focus?: string; spotlight?: string; title?: string; system?: string; audio?: string; drawing?: string },
): Promise<void> {
  const doc = resolve(opts.drawing ?? c.doc);
  const step: TourStep = {
    doc,
    say: opts.say,
    ...(opts.focus ? { focus: opts.focus } : {}),
    ...(opts.spotlight ? { spotlight: opts.spotlight.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.system ? { system: resolve(opts.system) } : isSysdfPath(c.doc) && doc !== resolve(c.doc) ? { system: resolve(c.doc) } : {}),
    ...(opts.audio ? { audio: opts.audio } : {}),
  };
  const problems = validateStep(step);
  if (problems.length) throw new Error(problems.map((p) => `${p.ruleId} ${p.message}`).join("\n"));
  out(await push(c, "step", (client) => client.emitStep({ stage: stageName(c), step })));
}

export async function stagePlay(c: StageCtx, tour: string, opts: { from?: number; paused?: boolean }): Promise<void> {
  const path = resolve(tour);
  const def = JSON.parse(readFileSync(path, "utf8"));
  if (!isTourDefinition(def)) throw new Error(`${path} is not a tour (no steps)`);
  const problems = validateTour(def);
  if (problems.length) throw new Error(problems.map((p) => `${p.ruleId}${p.step !== undefined ? ` step ${p.step + 1}` : ""}: ${p.message}`).join("\n"));
  const from = Math.max(0, Math.min(def.steps.length, opts.from ?? 1) - 1);
  out(
    await push(c, "tour", (client) =>
      client.emitLoad({ stage: stageName(c), tour: resolveTourPaths(def, path), path, from, autoplay: !opts.paused }),
    ),
  );
}

export async function stageControl(c: StageCtx, action: string, index?: number): Promise<void> {
  if (!STAGE_ACTIONS.includes(action as StageAction)) throw new Error(`action is one of ${STAGE_ACTIONS.join(", ")}`);
  if (action === "goto" && !index) throw new Error("goto needs a step number (from 1)");
  out(await push(c, "control", (client) => client.emitControl({ stage: stageName(c), action: action as StageAction, ...(index ? { index: index - 1 } : {}) })));
}

/** One line of what the person's canvas shows, for a prompt. */
export async function stageWhere(c: StageCtx): Promise<void> {
  const state = await stageState(c);
  const ctx: StageContext | null = state?.context ?? null;
  out(formatReview(ctx, []).split("\n")[0]);
}
