/**
 * Marks and the stage's context as words an agent reads (Spec 83).
 *
 * The review is numbered and plain, as `@miadi/annotate-core` exports a review
 * of a reply, so a person can paste it into any agent's prompt and an agent
 * reading it through MCP sees the same text: who said what, about which
 * elements of which drawing, and what is still waiting.
 */
import type { Mark, StageContext } from "./definition.js";
import { markAnchorText } from "./marks.js";

export interface DocMarks {
  /** The drawing's path (absolute, or as the reader knows it). */
  doc: string;
  marks: readonly Mark[];
}

const fileName = (p: string): string => p.split("/").pop() || p;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * One numbered entry per mark, with its thread indented under it:
 *
 *     1. [open · comment] Guillaume on state:Pending, state:Active (wave.smdf.json) — m-lq2x0a1b
 *        "why does the walk stop here?"
 *        ↳ agent: "the guard reads a field the ERD does not have"
 */
export function formatMarks(docs: readonly DocMarks[], options: { start?: number } = {}): string {
  const lines: string[] = [];
  let n = options.start ?? 1;
  for (const { doc, marks } of docs) {
    for (const m of marks) {
      lines.push(`${n}. [${m.status} · ${m.kind}] ${m.author.name}${m.author.role === "agent" ? " (agent)" : ""} on ${markAnchorText(m)} (${fileName(doc)}) — ${m.id}`);
      lines.push(`   "${oneLine(m.text)}"`);
      for (const r of m.replies ?? []) lines.push(`   ↳ ${r.author.name}${r.author.role === "agent" ? " (agent)" : ""}: "${oneLine(r.text)}"`);
      n++;
    }
  }
  return lines.join("\n");
}

/** What the person is looking at, in one or two lines. */
export function formatContext(ctx: StageContext | null | undefined): string {
  if (!ctx || !ctx.doc) return "No canvas has said what it is showing.";
  const parts = [`${ctx.who ? `${ctx.who} is` : "The canvas is"} on ${fileName(ctx.doc)}${ctx.kind ? ` (${ctx.kind})` : ""}`];
  if (ctx.system) parts.push(`as a member of ${fileName(ctx.system)}`);
  if (ctx.focus) parts.push(`with ${ctx.focus} in hand`);
  let line = parts.join(", ") + ".";
  if (ctx.tour) {
    line += ` Tour ${ctx.tour.title ? `'${ctx.tour.title}' ` : ""}at step ${ctx.tour.index + 1} of ${ctx.tour.count}, ${ctx.tour.playing ? "playing" : "paused"}.`;
  }
  if (ctx.at) line += ` (reported ${ctx.at})`;
  return line;
}

/**
 * The whole context for a reply: what is on screen, then the marks waiting —
 * the block a person pastes, or an agent reads, before answering.
 */
export function formatReview(ctx: StageContext | null | undefined, docs: readonly DocMarks[]): string {
  const count = docs.reduce((n, d) => n + d.marks.length, 0);
  const head = formatContext(ctx);
  if (!count) return `${head}\nNo marks.`;
  return `${head}\n${count} mark(s):\n${formatMarks(docs)}`;
}
