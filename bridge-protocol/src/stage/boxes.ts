/**
 * Where each element of a drawing sits, as boxes in the drawing's coordinates
 * (Spec 83): what a stage lights, frames and pins, and what a person's tap or
 * drawn area hits.
 *
 * A canvas knows its own geometry; these functions say it again from the same
 * layouts the canvases draw with, so a layer laid over any canvas — the
 * designer's, Miadi's, Forgewright's — agrees with it to the pixel without
 * reaching into it. Each takes what its board is drawing now: the machine's
 * one level, the ERD's positions, the sequence's layout.
 *
 * Pure: no React, no DOM.
 */
import type { Box } from "../viewport.js";
import type { LayoutBox } from "../autoLayout.js";
import type { StateDef } from "../definition.js";
import type { EntityRelationshipDefinition } from "../erd/definition.js";
import { ERD_BOX } from "../erd/layout.js";
import type { SequenceDefinition } from "../sequence/definition.js";
import { allMessages } from "../sequence/definition.js";
import type { SequenceLayout } from "../sequence/layout.js";

/** One element and where it is. Several boxes may share a focus (an event fired on two arrows). */
export interface ElementBox {
  focus: string;
  box: Box;
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function padBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The boxes of `focuses`, in order, every box of each. */
export function boxesOf(boxes: readonly ElementBox[], focuses: readonly string[]): Box[] {
  const want = new Set(focuses);
  return boxes.filter((b) => want.has(b.focus)).map((b) => b.box);
}

/**
 * The elements an area takes in: those with at least `share` of their own box
 * inside it (a third by default), so an area drawn loosely around three states
 * names those three and not their neighbour whose corner it grazed.
 */
export function elementsInRegion(boxes: readonly ElementBox[], region: Box, share = 1 / 3): string[] {
  const out: string[] = [];
  for (const { focus, box } of boxes) {
    const area = box.width * box.height;
    if (area <= 0 || out.includes(focus)) continue;
    if (overlapArea(box, region) / area >= share) out.push(focus);
  }
  return out;
}

/** The element under a point: the smallest box that holds it, so a message wins over the lifeline behind it. */
export function elementAt(boxes: readonly ElementBox[], x: number, y: number): string | null {
  let best: ElementBox | null = null;
  for (const b of boxes) {
    const { box } = b;
    if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) continue;
    if (!best || box.width * box.height < best.box.width * best.box.height) best = b;
  }
  return best?.focus ?? null;
}

// ─── The state designer: one level ───────────────────────────────────

/**
 * The states drawn at one level and the events of the arrows between them.
 * `states` are the level's children (`childStatesAt(root, path)`), `positions`
 * the board's boxes by state name. An event's box covers the arrow's two ends,
 * which is what a reader looks at to follow it.
 */
export function machineElementBoxes(states: readonly StateDef[], positions: Readonly<Record<string, LayoutBox>>): ElementBox[] {
  const out: ElementBox[] = [];
  for (const s of states) {
    const box = s?.name ? positions[s.name] : undefined;
    if (box) out.push({ focus: `state:${s.name}`, box });
  }
  for (const s of states) {
    const from = s?.name ? positions[s.name] : undefined;
    if (!from) continue;
    for (const t of s.transitions ?? []) {
      if (!t?.event) continue;
      const to = t.nextState ? positions[t.nextState] : undefined;
      out.push({ focus: `event:${t.event}`, box: to && states.some((x) => x.name === t.nextState) ? unionBox([from, to])! : from });
    }
  }
  return out;
}

// ─── The ERD ─────────────────────────────────────────────────────────

/**
 * Each entity's box, and each attribute's row inside it (`attribute:E.a`) when
 * the board draws rows — crow's foot does; Chen draws ovals around the box, so
 * pass `rows: false` and attributes answer with their entity's box.
 */
export function erdElementBoxes(
  def: EntityRelationshipDefinition,
  positions: Readonly<Record<string, LayoutBox>>,
  options: { rows?: boolean } = {},
): ElementBox[] {
  const rows = options.rows !== false;
  const out: ElementBox[] = [];
  for (const e of def?.entities ?? []) {
    const box = e?.name ? positions[e.name] : undefined;
    if (!box) continue;
    out.push({ focus: `entity:${e.name}`, box });
    (e.attributes ?? [])
      .filter((a) => a?.name)
      .forEach((a, r) => {
        out.push({
          focus: `attribute:${e.name}.${a.name}`,
          box: rows ? { x: box.x, y: box.y + ERD_BOX.headerHeight + r * ERD_BOX.rowHeight, width: box.width, height: ERD_BOX.rowHeight } : box,
        });
      });
  }
  return out;
}

// ─── The sequence ────────────────────────────────────────────────────

/** How far a message's band reaches above and below its arrow. */
const ROW_ABOVE = 24;
const ROW_BELOW = 16;
/** A message to oneself is a loop to the right: about this wide with its words. */
const SELF_WIDTH = 220;

/**
 * Each participant (its header and lifeline), each message (the band of its
 * row) and each event a message fires (`event:E`, on every row that fires it).
 */
export function sequenceElementBoxes(def: SequenceDefinition, layout: SequenceLayout): ElementBox[] {
  const out: ElementBox[] = [];
  for (const p of layout.participants) {
    out.push({
      focus: `participant:${p.name}`,
      box: { x: p.left, y: p.top, width: p.width, height: Math.max(p.height, layout.lifelineBottom - p.top) },
    });
  }
  const messages = new Map(allMessages(def).map((m) => [m.ref, m.message]));
  for (const row of layout.rows) {
    const left = row.self ? row.fromX : Math.min(row.fromX, row.toX);
    const width = row.self ? SELF_WIDTH : Math.max(40, Math.abs(row.toX - row.fromX));
    const box = { x: left - 10, y: row.y - ROW_ABOVE, width: width + 20, height: ROW_ABOVE + ROW_BELOW };
    out.push({ focus: `message:${row.ref}`, box });
    const event = messages.get(row.ref)?.event;
    if (event) out.push({ focus: `event:${event}`, box });
  }
  return out;
}
