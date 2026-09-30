/**
 * Where a sequence is drawn (Spec 81) — pure geometry the canvas and any
 * renderer share, as `erdAutoLayout` is for ERDs.
 *
 * Participants stand in one row, left to right in document order, each with a
 * lifeline. Main messages go down in order. Each fragment is drawn below the
 * main messages as a framed box holding its own messages, headed by its kind,
 * its label and the message it branches after — so the drawing never has to
 * interleave an alternative with the path it replaces.
 *
 * Pure — no I/O.
 */
import { messageRef, type SequenceDefinition } from "./definition.js";
import { textWidth } from "../edgeLabels.js";

export interface SequenceLayoutOptions {
  /** Minimum distance between two lifelines. */
  columnGap: number;
  /** Height of one message row. */
  rowHeight: number;
  headerHeight: number;
  /** Space between the header row and the first message. */
  topGap: number;
  /** Extra room above and below a fragment's messages (its heading sits in the top part). */
  fragmentPad: number;
  margin: number;
  fontSize: number;
}

export const SEQUENCE_LAYOUT_DEFAULTS: SequenceLayoutOptions = {
  columnGap: 150,
  rowHeight: 34,
  headerHeight: 34,
  topGap: 30,
  fragmentPad: 30,
  margin: 24,
  fontSize: 12,
};

export interface SequenceParticipantBox {
  name: string;
  /** Lifeline x. */
  x: number;
  /** Header box. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SequenceRow {
  /** `messageRef` — `"9"` or `"f1.2"`. */
  ref: string;
  fragment: number | null;
  index: number;
  y: number;
  fromX: number;
  toX: number;
  /** A participant sending to itself: drawn as a loop to the right. */
  self: boolean;
}

export interface SequenceFragmentBox {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Baseline of the heading line inside the box. */
  headingY: number;
}

export interface SequenceLayout {
  participants: SequenceParticipantBox[];
  rows: SequenceRow[];
  fragments: SequenceFragmentBox[];
  lifelineTop: number;
  lifelineBottom: number;
  width: number;
  height: number;
}

export function sequenceLayout(
  def: SequenceDefinition,
  options: Partial<SequenceLayoutOptions> = {},
): SequenceLayout {
  const o = { ...SEQUENCE_LAYOUT_DEFAULTS, ...options };
  // Read defensively: a hand-edited file or a peer's push may carry a nameless
  // participant or a null message, which S002/S003 report — the drawing must not throw.
  const participants = (Array.isArray(def.participants) ? def.participants : []).map((p) => ({
    ...p,
    name: typeof p?.name === "string" ? p.name : "",
  }));
  const mainMessages = (Array.isArray(def.messages) ? def.messages : []).filter(
    (m): m is NonNullable<typeof m> => !!m && typeof m === "object",
  );

  // Header widths from the names; columns wide enough for the widest label
  // between neighbours, never narrower than columnGap.
  const headerWidth = (name: string) => Math.max(90, textWidth(name, o.fontSize) + 28);
  const xs: number[] = [];
  let cursor = o.margin;
  participants.forEach((p, i) => {
    const w = headerWidth(p.name);
    if (i === 0) {
      xs.push(cursor + w / 2);
    } else {
      const prevW = headerWidth(participants[i - 1].name);
      const between = neighbourLabelWidth(mainMessages, def, participants[i - 1].name, p.name, o.fontSize);
      const gap = Math.max(o.columnGap, (prevW + w) / 2 + 20, between + 24);
      xs.push(xs[i - 1] + gap);
    }
  });
  const xOf = new Map(participants.map((p, i) => [p.name, xs[i]]));

  const boxes: SequenceParticipantBox[] = participants.map((p, i) => {
    const w = headerWidth(p.name);
    return { name: p.name, x: xs[i], left: xs[i] - w / 2, top: o.margin, width: w, height: o.headerHeight };
  });

  const rows: SequenceRow[] = [];
  let y = o.margin + o.headerHeight + o.topGap;
  // How far right a message to oneself reaches: its loop and label sit right of the lifeline.
  let selfReach = 0;
  const row = (fragment: number | null, index: number, from: string, to: string, label: string): void => {
    const fromX = xOf.get(from) ?? o.margin;
    const toX = xOf.get(to) ?? o.margin;
    const self = from === to;
    if (self) selfReach = Math.max(selfReach, fromX + 44 + textWidth(typeof label === "string" ? label : "", o.fontSize));
    rows.push({ ref: messageRef(fragment, index), fragment, index, y, fromX, toX, self });
    y += o.rowHeight;
  };
  // Rows keep the message's own index in the document, so a skipped null keeps the numbering.
  (Array.isArray(def.messages) ? def.messages : []).forEach((m, i) => {
    if (m && typeof m === "object") row(null, i, m.from, m.to, m.label);
  });

  const left = o.margin / 2;
  const lastHeader = xs.length ? xs[xs.length - 1] + headerWidth(participants[participants.length - 1].name) / 2 : o.margin;
  const right = Math.max(lastHeader, selfReach) + o.margin / 2;
  const fragments: SequenceFragmentBox[] = [];
  (Array.isArray(def.fragments) ? def.fragments : []).forEach((f, fi) => {
    if (!f || typeof f !== "object") return;
    y += o.rowHeight / 2;
    const top = y - o.rowHeight / 2;
    const headingY = top + 16;
    y += o.fragmentPad - o.rowHeight / 2 + 6;
    (Array.isArray(f.messages) ? f.messages : []).forEach((m, i) => {
      if (m && typeof m === "object") row(fi, i, m.from, m.to, m.label);
    });
    const height = y - top + o.fragmentPad / 2 - o.rowHeight / 2;
    fragments.push({ index: fi, left, top, width: right - left, height, headingY });
    y = top + height + o.rowHeight / 2;
  });

  const lifelineTop = o.margin + o.headerHeight;
  const lifelineBottom = y;
  return {
    participants: boxes,
    rows,
    fragments,
    lifelineTop,
    lifelineBottom,
    width: Math.max(right + o.margin / 2, o.margin * 2 + 200),
    height: lifelineBottom + o.margin,
  };
}

/** Widest label of a message between two neighbouring participants (either direction). */
function neighbourLabelWidth(
  main: SequenceDefinition["messages"],
  def: SequenceDefinition,
  a: string,
  b: string,
  fontSize: number,
): number {
  let widest = 0;
  const frags = Array.isArray(def.fragments) ? def.fragments : [];
  const all = [...main, ...frags.flatMap((f) => (Array.isArray(f?.messages) ? f.messages : []).filter((m) => !!m && typeof m === "object"))];
  for (const m of all) {
    if ((m.from === a && m.to === b) || (m.from === b && m.to === a)) {
      widest = Math.max(widest, textWidth(typeof m.label === "string" ? m.label : "", fontSize) + 30);
    }
  }
  return widest;
}
