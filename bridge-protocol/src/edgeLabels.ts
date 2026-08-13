/**
 * Where an event chip goes when four transitions want the same square inch.
 *
 * Every edge in an SMDF diagram is drawn the same way — bottom-centre of the
 * source curving to top-centre of the target — and every event label wants to
 * sit at the middle of its own curve. That works until a state fans out to
 * three siblings and each of them loops back: the midpoints land within a few
 * pixels of one another, and the chips print on top of each other. What the
 * reader sees is not four labels, it is one smear (`cadvance_contexon`), and a
 * smear is worse than no label at all.
 *
 * This module holds the arithmetic that settles them:
 *
 *   - `textWidth`/`chipSize` — how wide a plate has to be to actually contain
 *     the words on it. A fixed-width chip is the other half of the same defect:
 *     `confirm_observation` spills out of an 80-unit plate at both ends.
 *   - `guardText` — the far end of that: a guard is prose and can run to a
 *     paragraph, so the chip prints the first `GUARD_MAX_CHARS` of it and
 *     elides. A plate wide enough for a whole sentence is not a label.
 *   - `placeLabels` — offers each chip a handful of spots and takes the first
 *     that is clear of the chips already placed and of the state boxes.
 *
 * The curves the chips ride live next door in `edgeRoutes`, which gives each
 * edge its own attachment point on a box. That does the larger half of this
 * work: labels that start out spread apart rarely need to be moved at all.
 *
 * It lives in the protocol, not in either renderer, for the reason `autoLayout`
 * does: where a word can be read is not a browser concern. `smcx render` and
 * the MCP server settle labels headlessly, the web canvas settles them live,
 * and a picture exported from the toolbar should show the reader what the board
 * showed them. One implementation is the only way that stays true.
 *
 * Pure: no clock, no randomness, no DOM. Same input, same boxes, every time.
 */
import type { LayoutBox } from "./autoLayout.js";
import type { EdgePoint } from "./edgeRoutes.js";

/**
 * Rough advance width of `text` at `size`, in world units.
 *
 * Deliberately a formula and not a measurement: the CLI renders with no DOM to
 * measure in, and a chip whose width depends on the fonts a particular machine
 * happens to have installed would place labels differently in the designer than
 * in the picture exported from it. 0.55em per character is close enough for the
 * sans-serif stack both renderers name, and errs wide on lowercase ids — which
 * is the safe direction for a plate meant to contain its own text.
 */
export const textWidth = (text: string, size: number): number => text.length * size * 0.55;

/** Font size of the event id on a chip, and of the guard beneath it. */
export const LABEL_FONT_SIZE = 11;
export const GUARD_FONT_SIZE = 9;

/**
 * How many characters of a guard a chip will print before it elides.
 *
 * A condition is prose — `the return address matches where the seat actually
 * sits, and the lease posture was read locally` is a legitimate guard — and a
 * plate sized to contain it is six hundred units wide, wider than the states it
 * sits between. One such chip pushes every other label off its curve and the
 * board stops being a diagram of a machine. The full text is not lost: it lives
 * in the definition and is edited in the properties panel, where there is room
 * to read it. The chip only has to say *that there is a guard here, roughly
 * about this*.
 */
export const GUARD_MAX_CHARS = 32;

/**
 * The guard exactly as a chip draws it: bracketed, and elided past
 * `GUARD_MAX_CHARS`.
 *
 * `chipSize` measures this and the renderer prints it, which is the whole point
 * of it being one function — a plate measured against the full condition and
 * printed with a shortened one would be padded with empty space at both ends.
 */
export const guardText = (condition: string): string =>
  `[${
    condition.length > GUARD_MAX_CHARS
      ? `${condition.slice(0, GUARD_MAX_CHARS - 1).trimEnd()}…`
      : condition
  }]`;

/** Side of the trigger glyph a chip may carry, and the room reserved for it. */
export const GLYPH_SIZE = 12;
export const GLYPH_INSET = 5;
export const GLYPH_COLUMN = GLYPH_SIZE + GLYPH_INSET * 2 - 6;

/** A label waiting to be placed: its text, and the curve it may slide along. */
export interface PendingLabel {
  event: string;
  /** Guard text, drawn as `[condition]` on a second line. */
  condition?: string;
  /** Point on this label's own edge at parameter `t`, 0 = source, 1 = target. */
  at: (t: number) => EdgePoint;
  /**
   * Whether this chip carries a trigger glyph (see `glyphs.ts`). The plate
   * widens by `GLYPH_COLUMN` and its text re-centres in what is left, so a
   * board drawn with marks and one drawn without both stay legible.
   */
  glyph?: boolean;
}

/** Where a chip ended up: the box it occupies, and the centre its text hangs on. */
export interface PlacedLabel<T extends PendingLabel = PendingLabel> extends LayoutBox {
  /**
   * The `text-anchor="middle"` x for both lines. The centre of the plate when
   * there is no glyph, and the centre of what the glyph column leaves when
   * there is — which is why it is not always `x + width / 2`.
   */
  cx: number;
  /**
   * Vertical anchor. The event id sits at `cy - 5` and the guard at `cy + 7`,
   * which is why the box top is `cy - 18` for a chip of either height: the
   * one-line and two-line plates share a top edge and grow downward.
   */
  cy: number;
  label: T;
}

/** The plate a label needs: wide enough for its longest line, tall enough for both. */
export const chipSize = (label: PendingLabel): { width: number; height: number } => ({
  width:
    Math.max(
      56,
      Math.max(
        textWidth(label.event, LABEL_FONT_SIZE),
        label.condition ? textWidth(guardText(label.condition), GUARD_FONT_SIZE) : 0
      ) + 16
    ) + (label.glyph ? GLYPH_COLUMN : 0),
  height: label.condition ? 28 : 18,
});

/** Top-left of the trigger glyph on a placed chip, in the same units as the box. */
export const glyphAt = (spot: PlacedLabel): EdgePoint => ({
  x: spot.x + GLYPH_INSET,
  y: spot.cy - GLYPH_SIZE - 3,
});

export const overlaps = (a: LayoutBox, b: LayoutBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export interface PlaceLabelsOptions {
  /** Positions along each curve to try, midpoint outward. */
  along?: number[];
  /** Sideways nudges, in chip widths. */
  aside?: number[];
  /** Nudges across the curve, in chip heights — what unstacks a crowded row. */
  across?: number[];
}

export const PLACE_LABELS_DEFAULTS: Required<PlaceLabelsOptions> = {
  along: [0.5, 0.36, 0.64, 0.24, 0.76, 0.14, 0.86],
  aside: [0, 0.6, -0.6],
  across: [0, -1.3, 1.3, -2.6, 2.6],
};

/**
 * Settle every chip in one level onto a spot of its own.
 *
 * Each label is offered a handful of positions along its *own* curve — the
 * midpoint first, then progressively further toward either end, then nudged
 * sideways and across — and takes the first that clears both the chips already
 * placed and the `obstacles` (the state boxes, which are drawn last and would
 * otherwise cover half a word).
 *
 * Widest first: a long event id has the fewest places it can go, and a short
 * chip that took the only wide gap cannot be asked to move afterwards. Ties
 * keep declaration order.
 *
 * A label that can find no clear spot keeps the one that overlapped least, so a
 * chip is never dropped — a hidden transition is a lie about the machine, an
 * overlapping one is only hard to read.
 */
export function placeLabels<T extends PendingLabel>(
  pending: T[],
  obstacles: LayoutBox[],
  options: PlaceLabelsOptions = {}
): PlacedLabel<T>[] {
  const { along, aside, across } = { ...PLACE_LABELS_DEFAULTS, ...options };

  const order = pending
    .map((label, i) => ({ label, i, width: chipSize(label).width }))
    .sort((a, b) => (a.width === b.width ? a.i - b.i : b.width - a.width));

  const placed: PlacedLabel<T>[] = [];
  for (const { label } of order) {
    const { width, height } = chipSize(label);
    // A glyph takes the left of the plate, so the words centre on what is left.
    const textOffset = label.glyph ? GLYPH_COLUMN / 2 : 0;
    let best: PlacedLabel<T> | null = null;
    let bestCost = Infinity;

    search: for (const dy of across) {
      for (const dx of aside) {
        for (const t of along) {
          const point = label.at(t);
          const centre = point.x + dx * width;
          const cy = point.y + dy * height;
          const box: LayoutBox = { x: centre - width / 2, y: cy - 18, width, height };
          const cost = [...placed, ...obstacles].filter((other) => overlaps(box, other)).length;
          const spot = { ...box, cx: centre + textOffset, cy, label };
          if (cost === 0) {
            best = spot;
            break search;
          }
          if (cost < bestCost) {
            bestCost = cost;
            best = spot;
          }
        }
      }
    }
    if (best) placed.push(best);
  }
  return placed;
}
