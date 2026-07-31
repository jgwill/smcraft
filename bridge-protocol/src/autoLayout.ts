/**
 * Pure layered layout for SMDF definitions — no React, no DOM, no store.
 *
 * A machine that arrives without stored positions used to be laid out as a
 * single horizontal row: states ran off the right edge, event labels piled on
 * top of each other, and loop edges collapsed into a squashed line. This module
 * derives a readable arrangement instead, in the direction the canvas already
 * draws its edges (bottom-centre of the source → top-centre of the target):
 * top-to-bottom layers, siblings spread across each layer.
 *
 * The algorithm, per nesting level (a parent and its direct children — exactly
 * the set the canvas renders at one drill-down level):
 *
 *   1. Collect sibling transitions (self-loops and cross-level targets ignored,
 *      parallel duplicates collapsed).
 *   2. Classify back edges by DFS from the initial state (first declared child),
 *      continuing over any unvisited nodes in declaration order. An edge into a
 *      node still on the DFS stack is a back edge (`Review → Assembly`), so a
 *      loop never forces a cycle error nor drags its target downward.
 *   3. Layer the remaining (acyclic) forward edges by longest path: a state sits
 *      one layer below its deepest predecessor.
 *   4. Order within each layer by predecessor/successor barycentre, two sweeps,
 *      stable against declaration order — this is what keeps crossing edges and
 *      their labels apart.
 *   5. Place layers top-to-bottom, each layer centred horizontally against the
 *      widest one.
 *
 * States that belong to no component touching the initial state keep their own
 * internal depth but are pushed into trailing layers, below everything reachable.
 *
 * Composite states are laid out conservatively: the parent keeps the designer's
 * composite box size, and its children are arranged by the same algorithm
 * anchored just inside the parent's own position — the shape the web store has
 * always produced for nested levels, only ordered instead of strung out.
 *
 * The result is a flat `Record<stateName, box>` — the same shape as the web
 * designer's `layout.positions`, so it drops straight into the store and can be
 * reused by any other renderer (forgewright included).
 *
 * It lives in the protocol — not in the React binding where it was first
 * written — because the arrangement is not a browser concern: `smcx render` and
 * the MCP server draw the same boxes headlessly, and both already depend on
 * this package. `@miadi/stateloom-react` re-exports it, so the web imports it
 * from exactly where it always did.
 */
import type { StateDef, StateMachineDefinition } from "./definition.js";

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoLayoutOptions {
  /** Horizontal slot pitch between siblings in the same layer. */
  hSpacing?: number;
  /** Vertical pitch between consecutive layers (measured leaf-box to leaf-box). */
  vSpacing?: number;
  /** Box size for a leaf state. */
  nodeWidth?: number;
  nodeHeight?: number;
  /** Box size for a state that owns children. */
  compositeWidth?: number;
  compositeHeight?: number;
  /** Top-left anchor of the top-level arrangement. */
  originX?: number;
  originY?: number;
  /** Barycentre refinement passes (each pass = one down sweep + one up sweep). */
  sweeps?: number;
  /** Emit a bounding box for the root container state as well. */
  includeRoot?: boolean;
}

export const AUTO_LAYOUT_DEFAULTS: Required<AutoLayoutOptions> = {
  hSpacing: 220,
  vSpacing: 140,
  nodeWidth: 160,
  nodeHeight: 60,
  compositeWidth: 300,
  compositeHeight: 200,
  originX: 100,
  originY: 120,
  sweeps: 2,
  includeRoot: true,
};

type Opts = Required<AutoLayoutOptions>;

interface Edge {
  from: string;
  to: string;
}

const edgeKey = (from: string, to: string): string => `${from}\u0000${to}`;

/** Direct children of `parent`, de-duplicated by name (first declaration wins). */
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

/**
 * Transitions between siblings — the exact edge set the canvas draws for one
 * drill-down level. Self-loops and targets outside the level are skipped, and
 * two transitions between the same pair count once for layout purposes.
 */
function siblingEdges(children: StateDef[]): Edge[] {
  const names = new Set(children.map((c) => c.name));
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const child of children) {
    for (const t of child.transitions ?? []) {
      const to = t.nextState;
      if (!to || to === child.name || !names.has(to)) continue;
      const key = edgeKey(child.name, to);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: child.name, to });
    }
  }
  return edges;
}

function adjacency(names: string[], edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const e of edges) adj.get(e.from)!.push(e.to);
  return adj;
}

/**
 * Back edges under a DFS rooted at the initial state (first declared child),
 * then at any state the first pass never reached. An edge whose target is still
 * grey (on the current stack) closes a loop — `Review → Assembly` in the film
 * machine. Iterative so deep chains cannot blow the call stack.
 */
function findBackEdges(names: string[], edges: Edge[]): Set<string> {
  const adj = adjacency(names, edges);
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(names.map((n) => [n, WHITE]));
  const back = new Set<string>();

  for (const root of names) {
    if (color.get(root) !== WHITE) continue;
    color.set(root, GREY);
    const stack: { node: string; i: number }[] = [{ node: root, i: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const succs = adj.get(top.node)!;
      if (top.i < succs.length) {
        const next = succs[top.i++];
        const c = color.get(next);
        if (c === GREY) {
          back.add(edgeKey(top.node, next));
        } else if (c === WHITE) {
          color.set(next, GREY);
          stack.push({ node: next, i: 0 });
        }
        // BLACK: a forward/cross edge into a finished subtree — keep it.
      } else {
        color.set(top.node, BLACK);
        stack.pop();
      }
    }
  }
  return back;
}

/** Longest-path layering over an acyclic edge set (back edges already removed). */
function layerByLongestPath(names: string[], forward: Edge[]): Map<string, number> {
  const succ = adjacency(names, forward);
  const indeg = new Map<string, number>(names.map((n) => [n, 0]));
  for (const e of forward) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);

  const layer = new Map<string, number>(names.map((n) => [n, 0]));
  const queue = names.filter((n) => indeg.get(n) === 0);
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of succ.get(node)!) {
      layer.set(next, Math.max(layer.get(next)!, layer.get(node)! + 1));
      const remaining = indeg.get(next)! - 1;
      indeg.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return layer;
}

/** Undirected connected components over the whole sibling edge set. */
function componentOf(names: string[], edges: Edge[], seed: string): Set<string> {
  const neighbours = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const e of edges) {
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>([seed]);
  const stack = [seed];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const n of neighbours.get(node) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen;
}

/**
 * Barycentre ordering: a state drifts toward the average horizontal position of
 * the states it connects to. Down sweeps pull toward predecessors, up sweeps
 * toward successors; nodes with no neighbour in the reference direction hold
 * their current place. Ties resolve by current index, so the whole pass is
 * deterministic and declaration order survives where the graph says nothing.
 */
function orderLayers(layers: string[][], forward: Edge[], sweeps: number): void {
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const e of forward) {
    push(preds, e.to, e.from);
    push(succs, e.from, e.to);
  }

  const index = new Map<string, number>();
  const reindex = (): void => {
    layers.forEach((layer) => layer.forEach((name, i) => index.set(name, i)));
  };
  reindex();

  const sortLayer = (layer: string[], refs: Map<string, string[]>): void => {
    const keyed = layer.map((name, i) => {
      const neighbours = (refs.get(name) ?? []).filter((n) => index.has(n));
      const key = neighbours.length
        ? neighbours.reduce((sum, n) => sum + index.get(n)!, 0) / neighbours.length
        : i;
      return { name, key, i };
    });
    keyed.sort((a, b) => (a.key === b.key ? a.i - b.i : a.key - b.key));
    for (let i = 0; i < keyed.length; i++) layer[i] = keyed[i].name;
  };

  for (let pass = 0; pass < sweeps; pass++) {
    for (let li = 1; li < layers.length; li++) {
      sortLayer(layers[li], preds);
      reindex();
    }
    for (let li = layers.length - 2; li >= 0; li--) {
      sortLayer(layers[li], succs);
      reindex();
    }
  }
}

function boxSize(state: StateDef, o: Opts): { width: number; height: number } {
  const composite = (state.states?.length ?? 0) > 0;
  return composite
    ? { width: o.compositeWidth, height: o.compositeHeight }
    : { width: o.nodeWidth, height: o.nodeHeight };
}

/**
 * Arrange one level (the direct children of `parent`) into layers anchored at
 * `originX`/`originY`, writing into `positions`, then recurse into every child
 * that owns children of its own.
 */
function layoutLevel(
  parent: StateDef,
  originX: number,
  originY: number,
  o: Opts,
  positions: Record<string, LayoutBox>
): void {
  const children = childrenOf(parent);
  if (children.length === 0) return;

  const names = children.map((c) => c.name);
  const byName = new Map(children.map((c) => [c.name, c]));
  const edges = siblingEdges(children);
  const back = findBackEdges(names, edges);
  const forward = edges.filter((e) => !back.has(edgeKey(e.from, e.to)));

  const layerOf = layerByLongestPath(names, forward);

  // Anything not woven into the initial state's component keeps its own depth
  // but lands below everything reachable, instead of crowding layer 0.
  const reachable = componentOf(names, edges, names[0]);
  let mainMax = 0;
  for (const name of names) {
    if (reachable.has(name)) mainMax = Math.max(mainMax, layerOf.get(name)!);
  }
  for (const name of names) {
    if (!reachable.has(name)) layerOf.set(name, layerOf.get(name)! + mainMax + 1);
  }

  const depth = Math.max(...names.map((n) => layerOf.get(n)!)) + 1;
  const layers: string[][] = Array.from({ length: depth }, () => []);
  for (const name of names) layers[layerOf.get(name)!].push(name);

  orderLayers(layers, forward, o.sweeps);

  // Geometry. Slots absorb oversized (composite) boxes so a wide parent never
  // overlaps its neighbour, while plain leaf rows keep the requested pitch.
  const hGap = o.hSpacing - o.nodeWidth;
  const vGap = o.vSpacing - o.nodeHeight;
  const slotWidth = (width: number): number => Math.max(o.hSpacing, width + hGap);

  const sizes = new Map(names.map((n) => [n, boxSize(byName.get(n)!, o)]));
  const layerTotals = layers.map((layer) =>
    layer.reduce((sum, n) => sum + slotWidth(sizes.get(n)!.width), 0)
  );
  const widest = Math.max(...layerTotals, 0);
  const centerX = originX + widest / 2;

  let y = originY;
  layers.forEach((layer, li) => {
    let cursor = centerX - layerTotals[li] / 2;
    let tallest = o.nodeHeight;
    for (const name of layer) {
      const size = sizes.get(name)!;
      const slot = slotWidth(size.width);
      positions[name] = {
        x: Math.round(cursor + (slot - size.width) / 2),
        y: Math.round(y),
        width: size.width,
        height: size.height,
      };
      cursor += slot;
      tallest = Math.max(tallest, size.height);
    }
    y += tallest + vGap;
  });

  for (const child of children) {
    if ((child.states?.length ?? 0) === 0) continue;
    const box = positions[child.name];
    layoutLevel(child, box.x + 20, box.y + 40, o, positions);
  }
}

/**
 * Derive readable positions for every state in a definition.
 *
 * Accepts either a full `StateMachineDefinition` or a bare root `StateDef`.
 * Output is keyed by state name and is a pure function of the input — the same
 * definition always yields byte-identical boxes.
 */
export function autoLayout(
  def: StateMachineDefinition | StateDef,
  options: AutoLayoutOptions = {}
): Record<string, LayoutBox> {
  const o: Opts = { ...AUTO_LAYOUT_DEFAULTS, ...options };
  const root: StateDef = "state" in def ? def.state : def;
  const positions: Record<string, LayoutBox> = {};
  if (!root) return positions;

  layoutLevel(root, o.originX, o.originY, o, positions);

  if (o.includeRoot) {
    const children = childrenOf(root).map((c) => positions[c.name]).filter(Boolean);
    if (children.length === 0) {
      positions[root.name] = { x: 20, y: 20, width: 400, height: 350 };
    } else {
      const minX = Math.min(...children.map((b) => b.x));
      const minY = Math.min(...children.map((b) => b.y));
      const maxX = Math.max(...children.map((b) => b.x + b.width));
      const maxY = Math.max(...children.map((b) => b.y + b.height));
      positions[root.name] = {
        x: Math.round(minX - 40),
        y: Math.round(minY - 40),
        width: Math.round(maxX - minX + 80),
        height: Math.round(maxY - minY + 80),
      };
    }
  }

  return positions;
}
