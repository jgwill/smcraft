/**
 * Naming an exported diagram.
 *
 * `statemachine.png`, written again every time, is a file you lose: the second
 * export overwrites the first, and a folder of them says nothing about which
 * machine or which episode any of them came from. A name built here answers
 * three questions at a glance — where the work belongs, what it draws, and when
 * it was drawn:
 *
 *     ep252--InteractiveProduction--260730175243.svg
 *     └ episode  └ machine           └ yyMMddHHmmss
 *
 * The episode prefix appears only when the document actually lives under one
 * (`<episode>/diagrams/<name>.smdf.json`, the miadi-chronicle convention); a
 * machine outside the chronicle simply has no prefix to carry.
 *
 * Pure — the clock is an argument, never a call. Same inputs, same name.
 */

/**
 * `yyMMddHHmmss` in local time.
 *
 * Seconds are here because a designer exporting a PNG and then an SVG of the
 * same board does it inside one minute, and two names that differ only by
 * extension are two names that sort together but read as one.
 */
export function timeStamp(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return (
    two(at.getFullYear() % 100) +
    two(at.getMonth() + 1) +
    two(at.getDate()) +
    two(at.getHours()) +
    two(at.getMinutes()) +
    two(at.getSeconds())
  );
}

/** Strip the SMDF tails and any directory, leaving the document's bare name. */
function documentName(doc: string): string {
  const base = doc.split(/[/\\]/).pop() ?? doc;
  return base.replace(/\.smdf\.json$/i, "").replace(/\.json$/i, "");
}

/**
 * A file-system-safe version of `text`: spaces and separators become hyphens,
 * anything a shell or a filesystem would rather not see is dropped, and the
 * result is capped so one very long machine name cannot produce a name no tool
 * will accept.
 */
function slug(text: string): string {
  return text
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^A-Za-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
}

/**
 * The chronicle episode a document belongs to, as `ep252`, or null.
 *
 * Matches the folder shape episodes actually use —
 * `2026-07-19-episode-252-sprightly-sparrow-…` — and the shorter `ep103` some
 * paths carry instead.
 */
export function episodeOf(doc: string): string | null {
  const match = doc.match(/(?:^|[/\\-])ep(?:isode)?-?(\d{2,4})(?:[/\\-]|$)/i);
  return match ? `ep${match[1]}` : null;
}

export interface DiagramNameInput {
  /** Path (or bare name) of the project document being drawn. */
  doc?: string | null;
  /** The machine's own name — `settings.name`. Preferred over the file name. */
  machine?: string | null;
  /** Extension without the dot: `png`, `svg`, `mmd`, `md`. */
  format: string;
  /** The clock, passed in so this stays pure. */
  at: Date;
}

/**
 * Build the download name for a diagram export.
 *
 * Falls back through machine name → document name → `statemachine`, so a
 * board that has been given neither still lands under a name that reads.
 */
export function diagramFileName({ doc, machine, format, at }: DiagramNameInput): string {
  const named = slug(machine ?? "") || slug(doc ? documentName(doc) : "") || "statemachine";
  const episode = doc ? episodeOf(doc) : null;
  const prefix = episode ? `${episode}--` : "";
  return `${prefix}${named}--${timeStamp(at)}.${format}`;
}
