/**
 * Trigger glyphs — the small mark an event chip carries beside its name.
 *
 * Six chips reading `advance_context`, `advance_context`, `advance_context` are
 * three identical words the eye has to read one at a time. A mark in front of
 * each is what lets a reader tell one band of the board from another at a
 * glance, which is the same work the routing and the settling do by geometry,
 * finished by iconography.
 *
 * The shapes come from the Stateloom icon design, and they are UML/mermaid
 * vocabulary rather than invention: a chevron pair for advancing, a check for
 * confirming, a flag for marking, two bars for pausing. The label never leaves —
 * a glyph is added beside the words, never instead of them, so nothing is lost
 * for a reader who does not know the mark yet.
 *
 * They are path data, not font characters, so a PNG or SVG export carries them
 * on a host with no fonts installed. `renderMermaid` emits none — mermaid has no
 * icon vocabulary, and the text it already writes is the fallback.
 *
 * Pure data and one lookup: no clock, no randomness, no DOM.
 */

/** A circle in the 24×24 glyph box — kept apart from paths so both renderers can draw it. */
export interface GlyphCircle {
  cx: number;
  cy: number;
  r: number;
  /** Solid rather than outlined. */
  filled?: boolean;
}

export interface Glyph {
  /** Stable id, also the `<symbol>` name a renderer may register it under. */
  id: string;
  /** Stroked path data in a 0 0 24 24 box. */
  paths: string[];
  circles?: GlyphCircle[];
  /** Stroke weight in glyph-box units. */
  strokeWidth: number;
}

const glyph = (
  id: string,
  paths: string[],
  strokeWidth = 2.2,
  circles?: GlyphCircle[]
): Glyph => ({ id, paths, strokeWidth, circles });

/** The generic event: a signal arriving. What an unrecognised trigger gets. */
export const SIGNAL_GLYPH: Glyph = glyph("signal", ["M3 12h10", "m13 6 6 6-6 6Z"]);

/**
 * The vocabulary, in the order it is matched against an event id.
 *
 * Order matters where words overlap: `complete_sequence` is a completion before
 * it is anything else, and `resume_follow` is a resumption, not a summary.
 */
const VOCABULARY: { glyph: Glyph; words: string[] }[] = [
  { glyph: glyph("confirm", ["m4 13 5.5 5.5L20 6"], 2.4), words: ["confirm", "approve", "accept", "commit"] },
  {
    glyph: glyph("complete", ["m8 12 3 3 5-6"], 2.2, [{ cx: 12, cy: 12, r: 8.5 }]),
    words: ["complete", "finish", "done", "close"],
  },
  { glyph: glyph("skip", ["M4 17c0-6 4.5-9 9-9h6", "m15 4 4.5 4-4.5 4"]), words: ["skip", "ignore", "bypass"] },
  { glyph: glyph("flag", ["M6 21V4", "M6 4h12l-3 4.5 3 4.5H6Z"]), words: ["flag", "mark", "revisit", "review"] },
  { glyph: glyph("advance", ["M4 6l8 6-8 6Z", "M13 6l7 6-7 6Z"]), words: ["advance", "next", "forward", "step"] },
  { glyph: glyph("pause", ["M9 5v14M15 5v14"], 2.6), words: ["pause", "hold", "suspend", "stop"] },
  { glyph: glyph("play", ["M7 4.5 19 12 7 19.5Z"]), words: ["resume", "start", "begin", "play", "run"] },
  {
    glyph: glyph("clock", ["M12 7.5V12l3.5 2.5"], 2.2, [{ cx: 12, cy: 12, r: 8.5 }]),
    words: ["timeout", "expire", "tick", "delay", "after", "elapse"],
  },
  { glyph: glyph("change", ["M3 14c3-6 6-6 9 0s6 6 9 0"]), words: ["change", "update", "edit", "modify", "set"] },
];

/** Every glyph this module can return, `signal` included — for a `<defs>` block. */
export const ALL_GLYPHS: Glyph[] = [SIGNAL_GLYPH, ...VOCABULARY.map((entry) => entry.glyph)];

/**
 * The mark for an event id.
 *
 * Matched on the words inside the id — `confirm_observation`, `confirmObs` and
 * `CONFIRM` all read as a confirmation — and falling back to the signal glyph,
 * which is the honest answer for a name this vocabulary has nothing to say
 * about. A wrong-looking mark on an unusual id is why the words stay: the chip
 * still says what it is.
 */
export function eventGlyph(eventId: string): Glyph {
  const name = eventId.toLowerCase();
  for (const { glyph: mark, words } of VOCABULARY) {
    if (words.some((word) => name.includes(word))) return mark;
  }
  return SIGNAL_GLYPH;
}
