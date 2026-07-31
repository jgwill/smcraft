/**
 * Pure, deterministic SVG rendering of a definition — the board as a picture.
 *
 * The web canvas draws one drill-down level at a time; a still image has no
 * double-click, so this draws the *whole* tree in one frame. Every level is
 * laid out by the same `autoLayout` the designer uses, so an exported diagram
 * and the live board agree on where the boxes sit, and the palette is lifted
 * from `Canvas.tsx` so they agree on what they look like.
 *
 * A composite state keeps the box autoLayout gives it, and its children are
 * drawn inside as a scaled miniature (`translate … scale`) rather than being
 * re-flowed. Two things follow: a parent can never grow into its neighbour, and
 * nesting of any depth renders without a second layout pass.
 *
 * Transitions are drawn as the canvas draws them — bottom-centre of the source
 * curving to top-centre of the target — when both ends live at the same level.
 * A self-loop becomes an arc off the right edge. A transition leaving the level
 * entirely (the one shape a curve cannot honestly show) is written under its
 * source as `event → Target`, so nothing in the machine goes unrepresented.
 *
 * Pure: no clock, no randomness, no I/O. The same definition always renders the
 * same bytes.
 */
import {
  autoLayout,
  type LayoutBox,
  type StateDef,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";

export type SvgTheme = "dark" | "light";

export interface SvgRenderOptions {
  /** Hand-placed boxes (the designer's board). Missing names fall back to the derivation. */
  positions?: Record<string, LayoutBox>;
  /** Blank margin around the content, in world units. */
  padding?: number;
  /** Caption drawn above the board. `false` draws none; omitted uses the machine name. */
  title?: string | false;
  theme?: SvgTheme;
}

interface Palette {
  bg: string;
  node: string;
  composite: string;
  final: string;
  border: string;
  label: string;
  badge: string;
  edge: string;
  chip: string;
  chipBorder: string;
  chipText: string;
  guard: string;
  entry: string;
  exit: string;
  nested: string;
  title: string;
  subtitle: string;
}

const PALETTES: Record<SvgTheme, Palette> = {
  dark: {
    bg: "#030712",
    node: "#0f172a",
    composite: "#0c1020",
    final: "#1e293b",
    border: "#475569",
    label: "#e2e8f0",
    badge: "#64748b",
    edge: "#94a3b8",
    chip: "#1e293b",
    chipBorder: "#334155",
    chipText: "#94a3b8",
    guard: "#64748b",
    entry: "#22c55e",
    exit: "#f97316",
    nested: "#6366f1",
    title: "#e2e8f0",
    subtitle: "#64748b",
  },
  light: {
    bg: "#ffffff",
    node: "#f8fafc",
    composite: "#f1f5f9",
    final: "#e2e8f0",
    border: "#94a3b8",
    label: "#0f172a",
    badge: "#64748b",
    edge: "#64748b",
    chip: "#ffffff",
    chipBorder: "#cbd5e1",
    chipText: "#475569",
    guard: "#64748b",
    entry: "#15803d",
    exit: "#c2410c",
    nested: "#4f46e5",
    title: "#0f172a",
    subtitle: "#64748b",
  },
};

const FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Rough advance width of `text` at `size`, good enough to fit a chip around it. */
const textWidth = (text: string, size: number): number => text.length * size * 0.55;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shorten `text` with an ellipsis until it fits `max` world units at `size`. */
function fit(text: string, max: number, size: number): string {
  if (textWidth(text, size) <= max) return text;
  const room = Math.max(1, Math.floor(max / (size * 0.55)) - 1);
  return `${text.slice(0, room)}…`;
}

const isComposite = (state: StateDef): boolean => (state.states?.length ?? 0) > 0;

/** Direct children, de-duplicated by name — the same set autoLayout arranges. */
function childrenOf(parent: StateDef): StateDef[] {
  const seen = new Set<string>();
  const out: StateDef[] = [];
  for (const child of parent.states ?? []) {
    if (seen.has(child.name)) continue;
    seen.add(child.name);
    out.push(child);
  }
  return out;
}

const union = (boxes: LayoutBox[]): LayoutBox | null => {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Every box in `state`'s subtree, excluding `state` itself. */
function subtreeBoxes(state: StateDef, pos: Record<string, LayoutBox>): LayoutBox[] {
  const out: LayoutBox[] = [];
  for (const child of childrenOf(state)) {
    const box = pos[child.name];
    if (box) out.push(box);
    out.push(...subtreeBoxes(child, pos));
  }
  return out;
}

const FALLBACK: LayoutBox = { x: 0, y: 0, width: 160, height: 60 };

/** Node body, name, kind badge, entry/exit marks — everything but the children. */
function drawNode(state: StateDef, box: LayoutBox, p: Palette, out: string[]): void {
  const composite = isComposite(state);
  const final = state.kind === "final";
  const history = state.kind === "history";
  const rx = history ? 30 : final ? 4 : 8;
  const fill = final ? p.final : composite ? p.composite : p.node;
  const dash = final ? ' stroke-dasharray="6 3"' : composite ? ' stroke-dasharray="4 2"' : "";

  out.push(
    `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${rx}" ` +
      `fill="${fill}" stroke="${p.border}" stroke-width="1.5"${dash}/>`
  );

  // A composite titles itself at the top — the space below belongs to its
  // children. A leaf centres its name in the box, as the canvas does.
  const nameY = composite ? box.y + 20 : box.y + box.height / 2 + 5;
  const nameX = composite ? box.x + 10 : box.x + box.width / 2;
  const anchor = composite ? "start" : "middle";
  out.push(
    `<text x="${nameX}" y="${nameY}" fill="${p.label}" font-family="${FONT}" font-size="14" ` +
      `font-weight="600" text-anchor="${anchor}">${esc(fit(state.name, box.width - 20, 14))}</text>`
  );

  if (state.kind && state.kind !== "normal") {
    out.push(
      `<text x="${box.x + box.width - 8}" y="${box.y + 14}" fill="${p.badge}" ` +
        `font-family="${FONT}" font-size="10" text-anchor="end">${esc(state.kind)}</text>`
    );
  }
  if ((state.onEntry?.actions?.length ?? 0) > 0) {
    out.push(
      `<text x="${box.x + 6}" y="${box.y + box.height - 6}" fill="${p.entry}" ` +
        `font-family="${FONT}" font-size="9">▸entry</text>`
    );
  }
  if ((state.onExit?.actions?.length ?? 0) > 0) {
    out.push(
      `<text x="${box.x + box.width - 6}" y="${box.y + box.height - 6}" fill="${p.exit}" ` +
        `font-family="${FONT}" font-size="9" text-anchor="end">exit◂</text>`
    );
  }
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** A label waiting to be placed: its text, and the curve it may slide along. */
interface PendingLabel {
  event: string;
  condition?: string;
  /** Point on the label's own edge at parameter `t`, 0 = source, 1 = target. */
  at: (t: number) => { x: number; y: number };
}

/** Where a chip ends up: the resolved centre, and the box it occupies. */
interface PlacedLabel extends LayoutBox {
  cx: number;
  cy: number;
  label: PendingLabel;
}

const overlaps = (a: LayoutBox, b: LayoutBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Cubic bezier point at `t` — the geometry every non-loop edge is drawn with. */
function bezier(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): (t: number) => { x: number; y: number } {
  return (t: number) => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  };
}

const chipSize = (label: PendingLabel): { width: number; height: number } => ({
  width: Math.max(
    56,
    Math.max(
      textWidth(label.event, 11),
      label.condition ? textWidth(`[${label.condition}]`, 9) : 0
    ) + 16
  ),
  height: label.condition ? 28 : 18,
});

/**
 * Settle every chip in one level onto a spot of its own.
 *
 * Four transitions leaving the same state land their midpoints within a few
 * pixels of each other, and a stack of unreadable chips is worse than no label
 * at all. Each one is offered a handful of positions along its *own* curve —
 * the midpoint first, then progressively further toward either end — and takes
 * the first that clears both the chips already placed and the state boxes,
 * which are drawn last and would otherwise cover half a word. A label that can
 * find no clear spot keeps the one that overlapped least, so a chip is never
 * dropped. Order of consideration is the order the transitions are declared, so
 * the outcome is the same on every render.
 */
function placeLabels(pending: PendingLabel[], obstacles: LayoutBox[]): PlacedLabel[] {
  /** Positions along the curve, midpoint outward. */
  const ALONG = [0.5, 0.36, 0.64, 0.24, 0.76, 0.14, 0.86];
  /** Sideways nudges, in chip widths. */
  const ASIDE = [0, 0.6, -0.6];
  /** Nudges across the curve, in chip heights — what unstacks a crowded row. */
  const ACROSS = [0, -1.3, 1.3, -2.6, 2.6];

  // Widest first: a long event id has the fewest places it can go, and a short
  // chip that took the only wide gap cannot be asked to move afterwards. Ties
  // keep declaration order, so the whole pass stays deterministic.
  const order = pending
    .map((label, i) => ({ label, i, width: chipSize(label).width }))
    .sort((a, b) => (a.width === b.width ? a.i - b.i : b.width - a.width));

  const placed: PlacedLabel[] = [];
  for (const { label } of order) {
    const { width, height } = chipSize(label);
    let best: PlacedLabel | null = null;
    let bestCost = Infinity;

    search: for (const across of ACROSS) {
      for (const aside of ASIDE) {
        for (const t of ALONG) {
          const point = label.at(t);
          const cx = point.x + aside * width;
          const cy = point.y + across * height;
          const box: LayoutBox = { x: cx - width / 2, y: cy - 18, width, height };
          const cost = [...placed, ...obstacles].filter((other) => overlaps(box, other)).length;
          if (cost === 0) {
            best = { ...box, cx, cy, label };
            break search;
          }
          if (cost < bestCost) {
            bestCost = cost;
            best = { ...box, cx, cy, label };
          }
        }
      }
    }
    if (best) placed.push(best);
  }
  return placed;
}

/** Emit the chip: a rounded plate, the event id, and the guard beneath it. */
function drawLabel(spot: PlacedLabel, p: Palette, out: string[]): void {
  const { event, condition } = spot.label;
  out.push(
    `<rect x="${round(spot.x)}" y="${round(spot.y)}" width="${round(spot.width)}" ` +
      `height="${spot.height}" rx="4" fill="${p.chip}" stroke="${p.chipBorder}" stroke-width="1"/>`
  );
  out.push(
    `<text x="${round(spot.cx)}" y="${round(spot.cy - 5)}" fill="${p.chipText}" ` +
      `font-family="${FONT}" font-size="11" font-weight="500" text-anchor="middle">` +
      `${esc(event)}</text>`
  );
  if (condition) {
    out.push(
      `<text x="${round(spot.cx)}" y="${round(spot.cy + 7)}" fill="${p.guard}" ` +
        `font-family="${FONT}" font-size="9" text-anchor="middle">[${esc(condition)}]</text>`
    );
  }
}

/**
 * One nesting level: the edges between `children`, their boxes, and — for each
 * composite — a scaled miniature of its own level nested inside its box.
 *
 * `extents` collects the ink this level actually laid down, chips included, so
 * the caller can frame a picture that clips none of it. Only the outermost
 * level passes one; a nested level is bounded by its parent's box regardless.
 */
function drawLevel(
  parent: StateDef,
  pos: Record<string, LayoutBox>,
  p: Palette,
  out: string[],
  extents?: LayoutBox[]
): void {
  const children = childrenOf(parent);
  if (children.length === 0) return;
  const here = new Set(children.map((c) => c.name));
  const boxOf = (name: string): LayoutBox => pos[name] ?? FALLBACK;

  // A transition with no curve at this level — one that fires without leaving
  // its state, or one that lands somewhere else in the tree — is written under
  // its source rather than dropped. Everything the machine can do stays on the
  // page even when the geometry cannot carry it. Their spots are settled first
  // so the event chips can steer around them.
  const stubs: { box: LayoutBox; text: string; x: number; y: number }[] = [];
  for (const child of children) {
    const box = boxOf(child.name);
    const away = (child.transitions ?? []).filter(
      (t) => !t.nextState || (t.nextState !== child.name && !here.has(t.nextState))
    );
    away.slice(0, 3).forEach((t, i) => {
      const text = fit(t.nextState ? `${t.event} → ${t.nextState}` : `${t.event} ↻`, box.width + 60, 9);
      const y = box.y + box.height + 13 + i * 11;
      stubs.push({
        text,
        x: box.x + box.width / 2,
        y,
        box: {
          x: box.x + box.width / 2 - textWidth(text, 9) / 2,
          y: y - 8,
          width: textWidth(text, 9),
          height: 11,
        },
      });
    });
  }

  // Edges next, so the boxes land on top of the arrowheads exactly as the
  // canvas stacks them. Their labels are held back until every curve is known —
  // a chip can only avoid its neighbours once the neighbours exist.
  const labels: PendingLabel[] = [];
  for (const child of children) {
    const from = boxOf(child.name);
    for (const t of child.transitions ?? []) {
      if (!t.nextState || !here.has(t.nextState)) continue;

      if (t.nextState === child.name) {
        // A self-loop: an arc off the right edge, where a bottom-to-top curve
        // would otherwise fold back through the box it starts in.
        const x = from.x + from.width;
        const y1 = from.y + from.height * 0.35;
        const y2 = from.y + from.height * 0.65;
        const bulge = 44;
        out.push(
          `<path d="M ${x} ${y1} C ${x + bulge} ${y1 - 12}, ${x + bulge} ${y2 + 12}, ${x} ${y2}" ` +
            `fill="none" stroke="${p.edge}" stroke-width="1.5" marker-end="url(#sm-arrow)"/>`
        );
        const cx = x + bulge + 30;
        const cy = from.y + from.height / 2 + 4;
        labels.push({ event: t.event, condition: t.condition, at: () => ({ x: cx, y: cy }) });
        continue;
      }

      const to = boxOf(t.nextState);
      const p0 = { x: from.x + from.width / 2, y: from.y + from.height };
      const p3 = { x: to.x + to.width / 2, y: to.y };
      const midY = (p0.y + p3.y) / 2;
      const p1 = { x: p0.x, y: midY };
      const p2 = { x: p3.x, y: midY };
      out.push(
        `<path d="M ${p0.x} ${p0.y} C ${p1.x} ${round(p1.y)}, ${p2.x} ${round(p2.y)}, ` +
          `${p3.x} ${p3.y}" fill="none" stroke="${p.edge}" stroke-width="1.5" ` +
          `marker-end="url(#sm-arrow)"/>`
      );
      labels.push({ event: t.event, condition: t.condition, at: bezier(p0, p1, p2, p3) });
    }
  }
  const obstacles = [...children.map((c) => boxOf(c.name)), ...stubs.map((s) => s.box)];
  for (const spot of placeLabels(labels, obstacles)) {
    drawLabel(spot, p, out);
    extents?.push(spot);
  }

  for (const stub of stubs) {
    out.push(
      `<text x="${round(stub.x)}" y="${round(stub.y)}" fill="${p.nested}" font-family="${FONT}" ` +
        `font-size="9" text-anchor="middle">${esc(stub.text)}</text>`
    );
    extents?.push(stub.box);
  }

  for (const child of children) {
    const box = boxOf(child.name);
    drawNode(child, box, p, out);
    if (!isComposite(child)) continue;

    // The children were laid out in the same world coordinates, anchored just
    // inside this box but free to run past it. Scaling the whole subtree into
    // the parent's inner area keeps every descendant visible without moving a
    // single box out from under its neighbour.
    const inner = {
      x: box.x + 10,
      y: box.y + 30,
      width: box.width - 20,
      height: box.height - 40,
    };
    const content = union(subtreeBoxes(child, pos));
    if (!content || inner.width <= 0 || inner.height <= 0) continue;

    const scale = Math.min(
      1,
      inner.width / Math.max(content.width, 1),
      inner.height / Math.max(content.height, 1)
    );
    const dx = inner.x + (inner.width - content.width * scale) / 2 - content.x * scale;
    const dy = inner.y + (inner.height - content.height * scale) / 2 - content.y * scale;

    out.push(`<g transform="translate(${round(dx)} ${round(dy)}) scale(${round(scale)})">`);
    drawLevel(child, pos, p, out);
    out.push(`</g>`);
  }
}

/**
 * Render `def` as a standalone SVG document.
 *
 * Positions come from `opts.positions` where given (the designer's own board)
 * and from `autoLayout` everywhere else, so a partially-dragged layout renders
 * without gaps.
 */
export function renderSvg(def: StateMachineDefinition, opts: SvgRenderOptions = {}): string {
  const p = PALETTES[opts.theme ?? "dark"];
  const padding = opts.padding ?? 48;
  const derived = autoLayout(def, { includeRoot: false });
  const positions = { ...derived, ...(opts.positions ?? {}) };

  const root = def.state;
  const body: string[] = [];
  const inked: LayoutBox[] = [];
  if (root) drawLevel(root, positions, p, body, inked);

  const title =
    opts.title === false ? null : opts.title ?? def.settings?.name ?? root?.name ?? "state machine";
  const titleHeight = title ? 34 : 0;

  // Only the outermost level frames the picture. A nested state's own boxes sit
  // wherever the layout put them in world coordinates, which can be well past
  // the parent that ends up drawing them as a miniature — counting those would
  // pad the page with margin around ink that was never there.
  const boxes = root
    ? childrenOf(root)
        .map((child) => positions[child.name])
        .filter(Boolean)
    : [];
  const content = union([...boxes, ...inked]) ?? { x: 0, y: 0, width: 320, height: 120 };
  const minX = content.x - padding;
  const minY = content.y - padding - titleHeight;
  // Bottom margin carries the stub labels a leaf may have written under itself.
  const width = Math.round(content.width + padding * 2);
  const height = Math.round(content.height + padding * 2 + titleHeight + 12);

  const head: string[] = [];
  if (title) {
    const states = countStates(root);
    head.push(
      `<text x="${round(minX + padding)}" y="${round(minY + padding - 12)}" fill="${p.title}" ` +
        `font-family="${FONT}" font-size="16" font-weight="600">${esc(title)}</text>`
    );
    head.push(
      `<text x="${round(minX + padding)}" y="${round(minY + padding + 4)}" fill="${p.subtitle}" ` +
        `font-family="${FONT}" font-size="10">${states} state${states === 1 ? "" : "s"}</text>`
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="${round(minX)} ${round(minY)} ${width} ${height}">`,
    `<defs>`,
    `<marker id="sm-arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`,
    `<polygon points="0 0, 10 3.5, 0 7" fill="${p.edge}"/>`,
    `</marker>`,
    `</defs>`,
    `<rect x="${round(minX)}" y="${round(minY)}" width="${width}" height="${height}" fill="${p.bg}"/>`,
    ...head,
    ...body,
    `</svg>`,
  ].join("\n");
}

/** Total states under `state`, itself excluded — the caption's count. */
function countStates(state: StateDef | undefined): number {
  if (!state) return 0;
  return childrenOf(state).reduce((n, child) => n + 1 + countStates(child), 0);
}
