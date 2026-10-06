// evidence — what a lane check reads about one agent session, read only.
//
// Sources, all on this host: the binding line (which tmux session and folder a session
// has), the hook capture (the person's inputs), the transcript (what the agent said, the
// files it wrote, the commits it made), the witness asks ledger (the person's asks, when a
// seat keeps one) and the tmux pane (what is on screen now). Nothing here writes anywhere.
//
// The witness plugin already reads the first three; its libraries are imported from the
// orchestration kit in place ($MIADI_ORCHESTRATION_KIT_ROOT), not copied.

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const KIT = process.env.MIADI_ORCHESTRATION_KIT_ROOT || "/workspace/repos/jgwill/miadi-orchestration-kit";
const WITNESS = join(KIT, "claude", "miadi-witness");

export async function loadWitness() {
  const load = (rel) => import(pathToFileURL(join(WITNESS, rel)).href);
  const [threads, links, asks] = await Promise.all([
    load("service/threads.mjs"),
    load("scripts/links-lib.mjs"),
    load("scripts/asks-lib.mjs"),
  ]);
  return { threads, links, asks };
}

// The binding lines for one lane, named by its Claude session id or its tmux session name.
// The latest start, resume or rename wins; a later end marks the session ended.
export function resolveLane(target, bindingLines) {
  const own = bindingLines.filter((line) => line.agent === "claude" && (line.session_id === target || line.tmux?.session === target));
  if (!own.length) return null;
  const latest = own.reduce((a, b) => (String(a.at) >= String(b.at) ? a : b));
  const sessionId = latest.session_id;
  const lines = bindingLines.filter((line) => line.session_id === sessionId);
  const start = lines.filter((line) => line.event === "session.start").map((line) => line.at).sort()[0] ?? latest.at;
  const ended = lines.some((line) => line.event === "session.end" && String(line.at) >= String(latest.at));
  return {
    sessionId,
    tmux: latest.tmux?.session ?? null,
    paneId: latest.tmux?.pane_id ?? null,
    cwd: latest.cwd ?? null,
    transcript: latest.transcript_path ?? null,
    team: latest.team?.id ?? null,
    episode: latest.episode?.id ?? null,
    name: latest.name?.name ?? null,
    startedAt: start,
    ended,
  };
}

// Every lane with a live Claude process, by its session file.
export function liveLanes(bindingLines, sessionFiles) {
  const live = new Set(sessionFiles.filter((s) => s.alive).map((s) => s.sessionId));
  const seen = new Map();
  for (const line of bindingLines) {
    if (line.agent === "claude" && live.has(line.session_id) && line.tmux?.session) seen.set(line.session_id, line.tmux.session);
  }
  return [...seen.keys()];
}

function readTail(path, bytes) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    closeSync(fd);
  }
}

const COMMIT_LINE = /\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,12})\] ([^\n]{1,160})/g;
const PUSH_LINE = /([0-9a-f]{7,12})\.\.([0-9a-f]{7,12})\s+(\S+) -> (\S+)/g;

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : part?.text ?? (typeof part?.content === "string" ? part.content : textOf(part?.content)))).join("\n");
}

// What the transcript shows: the agent's last words, the files it wrote, the commits and
// pushes its own tool calls reported, and a question to the person left without an answer.
export function readTranscript(path, { tailBytes = 2 * 1024 * 1024, lastMessages = 3 } = {}) {
  if (!path || !existsSync(path)) return null;
  const whole = statSync(path).size <= 64 * 1024 * 1024;
  const text = whole ? readFileSync(path, "utf8") : readTail(path, tailBytes);
  const files = new Set();
  const commits = new Map();
  const pushes = [];
  const said = [];
  let openQuestion = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (entry.type === "assistant" && Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && part.text?.trim()) said.push({ at: entry.timestamp ?? null, text: part.text.trim() });
        if (part.type === "tool_use") {
          const target = part.input?.file_path ?? part.input?.notebook_path;
          if (target && /^(Write|Edit|NotebookEdit|MultiEdit)$/.test(part.name)) files.add(target);
          if (part.name === "AskUserQuestion") openQuestion = { at: entry.timestamp ?? null, id: part.id, questions: (part.input?.questions ?? []).map((q) => q.question) };
        }
      }
    }
    if (entry.type === "user" && Array.isArray(content)) {
      for (const part of content) {
        if (part.type !== "tool_result") continue;
        if (openQuestion && part.tool_use_id === openQuestion.id) openQuestion = null;
        const out = textOf(part.content);
        for (const m of out.matchAll(COMMIT_LINE)) commits.set(m[2], { sha: m[2], branch: m[1], subject: m[3] });
        for (const m of out.matchAll(PUSH_LINE)) pushes.push({ from: m[1], to: m[2], ref: m[4] });
      }
    }
  }
  return {
    read_whole: whole,
    last_messages: said.slice(-lastMessages),
    files_touched: [...files],
    commits: [...commits.values()],
    pushes,
    unanswered_question: openQuestion,
  };
}

// A Claude Code turn in progress: older builds print "esc to interrupt", newer ones a spinner
// line with an elapsed time, e.g. "✶ Zigzagging… (6m 48s · thought for 11s)".
export const RUNNING = /esc to interrupt|…\s*\((?:\d+h\s*)?(?:\d+m\s*)?\d+s\b/i;

// The tmux session's screen, by session id rather than name: a name with ':' breaks -t.
export function readPane(tmuxSession, { lines = 25 } = {}) {
  if (!tmuxSession) return null;
  try {
    const list = execFileSync("tmux", ["list-sessions", "-F", "#{session_id}\t#{session_name}"], { encoding: "utf8" });
    const id = list.split("\n").map((row) => row.split("\t")).find(([, name]) => name === tmuxSession)?.[0];
    if (!id) return null;
    const screen = execFileSync("tmux", ["capture-pane", "-p", "-t", id], { encoding: "utf8" });
    const rows = screen.split("\n").filter((row) => row.trim());
    return { rows: rows.slice(-lines), running: RUNNING.test(screen) };
  } catch {
    return null;
  }
}

function cut(text, max) {
  if (typeof text !== "string") return text;
  return text.length > max ? `${text.slice(0, max)} …[${text.length - max} more chars]` : text;
}

// The person's asks that name this session, from every seat's ledger.
export function asksFor(sessionId, ledgers) {
  const found = [];
  for (const ledger of ledgers) {
    for (const ask of ledger.asks ?? []) {
      const words = Array.isArray(ask.words) ? ask.words : [];
      if (!words.some((w) => w?.session_id === sessionId)) continue;
      found.push({ seat: ledger.seat, id: ask.id, title: ask.title, words: words.map((w) => w.text), status: ask.status, evidence: ask.evidence ?? [] });
    }
  }
  return found;
}

// One lane's state for the decider: small enough for Jev's 32k-token state budget.
export async function collectEvidence(lane, { witness, paths, ledgers = [], maxChars = 80_000 } = {}) {
  const { threads, links } = witness;
  const first = links.firstInput(paths.sessiondata, lane.sessionId, { maxChars: 2000 });
  const latest = threads.lastWilliamInput(paths.sessiondata, lane.sessionId, { maxChars: 1500 });
  const transcript = readTranscript(lane.transcript);
  const pane = readPane(lane.tmux);
  const asks = asksFor(lane.sessionId, ledgers);
  const state = {
    session: { id: lane.sessionId, tmux: lane.tmux, folder: lane.cwd, team: lane.team, episode: lane.episode, started_at: lane.startedAt, ended: lane.ended },
    question: first?.text ?? null,
    latest_request: latest?.text && latest.text !== first?.text ? latest.text : null,
    asks: asks.map((a) => ({ id: `${a.seat}/${a.id}`, title: a.title, words: a.words.map((w) => cut(w, 600)), recorded_status: a.status })),
    commits: transcript?.commits ?? [],
    pushes: transcript?.pushes ?? [],
    files_touched: transcript?.files_touched ?? [],
    last_messages: (transcript?.last_messages ?? []).map((m) => ({ at: m.at, text: cut(m.text, 4000) })),
    unanswered_question_to_person: transcript?.unanswered_question?.questions ?? null,
    screen: pane ? { running: pane.running, last_rows: pane.rows } : null,
  };
  // Shrink in a fixed order until it fits: older messages, then the file list, then the screen.
  const size = () => JSON.stringify(state).length;
  while (size() > maxChars && state.last_messages.length > 1) state.last_messages.shift();
  if (size() > maxChars) state.files_touched = [...state.files_touched.slice(0, 40), `…${state.files_touched.length - 40} more`];
  if (size() > maxChars && state.screen) state.screen.last_rows = state.screen.last_rows.slice(-8);
  if (size() > maxChars) state.last_messages = state.last_messages.map((m) => ({ ...m, text: cut(m.text, 1500) }));
  const refs = {
    question: first?.ref ?? null,
    transcript: lane.transcript,
    commits: (transcript?.commits ?? []).map((c) => c.sha),
  };
  return { state, refs, read: { first_input: Boolean(first), transcript: Boolean(transcript), pane: Boolean(pane), asks: asks.length } };
}
