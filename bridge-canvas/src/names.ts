/**
 * The elements a mark points at, named as the person sees them on the board (Spec 83).
 *
 * A mark keeps its elements as focus keys — `state:Witnessing`, `attribute:Screenwalk.state`,
 * `message:8` — which is what agents read. A person reads the board: a state's name, an
 * entity's name, a message's number and words. The host may pass `labels` (focus key →
 * words), which win; a sequence host gives each message its words that way.
 *
 * Pure: no React, no DOM.
 */
import type { Box } from "@miadi/stateloom-protocol";

export type ElementLabels = Readonly<Record<string, string>>;

/** One element by the name the board shows: `state:Witnessing` → "Witnessing", `message:8` → "message 8". */
export function elementName(focus: string, labels?: ElementLabels): string {
  const given = labels?.[focus];
  if (given) return given;
  const at = focus.indexOf(":");
  if (at <= 0) return focus;
  const kind = focus.slice(0, at);
  const name = focus.slice(at + 1);
  if (kind === "message") return `message ${name}`;
  if (kind === "attribute") {
    const dot = name.indexOf(".");
    return dot > 0 ? `${name.slice(dot + 1)} in ${name.slice(0, dot)}` : name;
  }
  return name;
}

/** The names of what is marked; an entity's attributes are left to the entity when it is marked too. */
export function markedNames(elements: readonly string[] | undefined, labels?: ElementLabels): string[] {
  const refs = elements ?? [];
  const marked = new Set(refs);
  return refs
    .filter((ref) => {
      const owner = /^attribute:([^.]+)\./.exec(ref);
      return !owner || !marked.has(`entity:${owner[1]}`);
    })
    .map((ref) => elementName(ref, labels));
}

/** "A", "A and B", "A, B and C", "A, B and 4 more". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** What a mark points at, in words: its elements, else an area (inside a machine's level), else the drawing. */
export function markPlace(mark: { elements?: readonly string[]; region?: Box | null; level?: string }, labels?: ElementLabels): string {
  const names = markedNames(mark.elements, labels);
  if (names.length) return namesText(names);
  if (mark.region) return mark.level && mark.level !== "Root" ? `an area inside ${mark.level}` : "an area";
  return "the drawing";
}

/** A drawing named for a person: its own name when known, else its file name without the format's extensions. */
export function drawingName(path: string | null | undefined, title?: string | null): string {
  if (title) return title;
  const file = path ? path.split("/").pop() ?? path : "";
  return file.replace(/\.(smdf|erdf|sqdf|sysdf)\.json$/i, "").replace(/\.json$/i, "") || "the drawing";
}

/** A mark as the conversation lists it: who wrote it, what it points at, and where it stands. */
export interface MarkLike {
  doc?: string;
  drawing?: string;
  title?: string;
  elements?: readonly string[];
  region?: Box | null;
  level?: string;
  status: string;
  author: { name?: string; role?: string };
}

export type MarkStanding = "waits for agent" | "waits for you" | "answered" | "resolved";

/**
 * Where a mark stands: a person's mark waits for the agent until answered; an agent's
 * question waits for the person until answered, and then for the agent.
 */
export function markStanding(mark: Pick<MarkLike, "status" | "author">): MarkStanding {
  if (mark.status === "resolved") return "resolved";
  const agent = mark.author?.role === "agent";
  if (mark.status === "answered") return agent ? "waits for agent" : "answered";
  return agent ? "waits for you" : "waits for agent";
}

/** "7 marks on Screenwalk, 6 answered, 1 resolved; 1 mark on ScreenwalkRecords, 1 answered". */
export function marksSummary(marks: readonly MarkLike[], who = "the agent"): string {
  const byDrawing = new Map<string, MarkLike[]>();
  for (const m of marks) {
    const name = drawingName(m.doc ?? m.drawing, m.title);
    byDrawing.set(name, [...(byDrawing.get(name) ?? []), m]);
  }
  return [...byDrawing.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, list]) => {
      const count = (s: MarkStanding) => list.filter((m) => markStanding(m) === s).length;
      const parts = [`${list.length} mark${list.length === 1 ? "" : "s"} on ${name}`];
      if (count("answered")) parts.push(`${count("answered")} answered`);
      if (count("waits for agent")) parts.push(`${count("waits for agent")} waiting on ${who}`);
      if (count("waits for you")) parts.push(`${count("waits for you")} waiting on you`);
      if (count("resolved")) parts.push(`${count("resolved")} resolved`);
      return parts.join(", ");
    })
    .join("; ");
}
