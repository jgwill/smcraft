/**
 * Where each entity box sits before anyone has dragged it — pure geometry.
 *
 * An entity is as tall as its attribute list and as wide as its longest row,
 * so unlike a state box its size is read from the definition. Placement is by
 * layer: the "one" side of a relationship sits above its "many" side, which
 * puts a parent over the tables that carry its foreign key — the way an ERD is
 * usually read. A relationship that would close a cycle is ignored for
 * layering (it is still drawn), so every definition gets a finite layout.
 *
 * Within that, three things keep lines out from behind boxes: a parent drops to
 * just above its nearest child, a line that spans several layers is given a
 * lane of its own in each layer it crosses, and each layer is ordered and
 * centred by where its neighbours sit.
 *
 * Pure: same definition, same boxes, every time.
 */
import type { LayoutBox } from "../autoLayout.js";
import type { EntityRelationshipDefinition, ErdEntity, ErdNotation, ErdRelationship } from "./definition.js";
import { erdChenFootprint } from "./chen.js";

export interface ErdLayoutOptions {
  hSpacing?: number;
  vSpacing?: number;
  /**
   * Which drawing the boxes are for. The placement rules are the same; what
   * changes is how much room an entity needs — a Chen entity reserves its
   * attribute ovals on both sides — and the room left between layers, where
   * Chen puts the relationship diamonds.
   */
  notation?: ErdNotation;
}

/** The row geometry both the layout and the canvas draw with. */
export const ERD_BOX = {
  headerHeight: 30,
  rowHeight: 20,
  padBottom: 8,
  minWidth: 170,
  maxWidth: 340,
  charWidth: 6.6,
  padX: 14,
  /** Room at the right of a row for the PK / UK / FK badges. */
  badgeWidth: 46,
} as const;

export const ERD_LAYOUT_DEFAULTS: Required<ErdLayoutOptions> = { hSpacing: 70, vSpacing: 90, notation: "crowsfoot" };

/** Chen needs the taller gap: a diamond sits between every two layers it joins. */
const CHEN_V_SPACING = 130;

/** The text of one attribute row, as the canvas writes it. */
export function erdRowText(attribute: { name: string; type: string }): string {
  return `${attribute.name} : ${attribute.type}`;
}

export function erdEntitySize(entity: ErdEntity): { width: number; height: number } {
  const rows = (entity.attributes ?? []).filter((a) => a?.name);
  const longest = Math.max(
    (entity.name ?? "").length * 1.15,
    ...rows.map((a) => erdRowText(a).length + ERD_BOX.badgeWidth / ERD_BOX.charWidth),
  );
  const width = Math.min(
    ERD_BOX.maxWidth,
    Math.max(ERD_BOX.minWidth, Math.ceil(longest * ERD_BOX.charWidth + ERD_BOX.padX * 2)),
  );
  const height = ERD_BOX.headerHeight + Math.max(1, rows.length) * ERD_BOX.rowHeight + ERD_BOX.padBottom;
  return { width, height };
}

/** [upper, lower] for layering: the "one" side goes above the "many" side. */
function layered(rel: ErdRelationship): [string, string] {
  return rel.cardinality === "N:1" ? [rel.to, rel.from] : [rel.from, rel.to];
}

/** Width kept clear, in each layer it crosses, for a line that spans several. */
const LANE_WIDTH = 28;

interface Slot {
  id: string;
  /** Present for an entity; absent for the lane a long line is given. */
  entity?: string;
  width: number;
  height: number;
  upper: string[];
  lower: string[];
  x: number;
}

export function erdAutoLayout(
  def: EntityRelationshipDefinition,
  options: ErdLayoutOptions = {},
): Record<string, LayoutBox> {
  const notation = options.notation ?? ERD_LAYOUT_DEFAULTS.notation;
  const hSpacing = options.hSpacing ?? ERD_LAYOUT_DEFAULTS.hSpacing;
  const vSpacing = options.vSpacing ?? (notation === "chen" ? CHEN_V_SPACING : ERD_LAYOUT_DEFAULTS.vSpacing);
  const sizeOf = notation === "chen" ? erdChenFootprint : erdEntitySize;
  const entities: ErdEntity[] = [];
  const seen = new Set<string>();
  for (const e of def.entities ?? []) {
    if (!e?.name || seen.has(e.name)) continue;
    seen.add(e.name);
    entities.push(e);
  }

  // 1. Layers. Longest path over the acyclic part of the relationships…
  const below = new Map<string, string[]>();
  const reaches = (from: string, target: string, visited = new Set<string>()): boolean => {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return (below.get(from) ?? []).some((next) => reaches(next, target, visited));
  };
  for (const rel of def.relationships ?? []) {
    if (!rel || !seen.has(rel.from) || !seen.has(rel.to) || rel.from === rel.to) continue;
    const [upper, lower] = layered(rel);
    if ((below.get(upper) ?? []).includes(lower)) continue;
    if (reaches(lower, upper)) continue; // would close a cycle
    const list = below.get(upper);
    if (list) list.push(lower);
    else below.set(upper, [lower]);
  }

  const layerOf = new Map<string, number>();
  const sink = (name: string, layer: number): void => {
    if ((layerOf.get(name) ?? -1) >= layer) return;
    layerOf.set(name, layer);
    for (const next of below.get(name) ?? []) sink(next, layer + 1);
  };
  const hasUpper = new Set([...below.values()].flat());
  for (const e of entities) if (!hasUpper.has(e.name)) sink(e.name, 0);
  for (const e of entities) if (!layerOf.has(e.name)) sink(e.name, 0);

  // …then each entity drops to just above its nearest child, bottom layer first,
  // so a parent sits beside the chain it does not belong to instead of far above it.
  for (const e of [...entities].sort((a, b) => layerOf.get(b.name)! - layerOf.get(a.name)!)) {
    const children = below.get(e.name) ?? [];
    if (children.length) layerOf.set(e.name, Math.min(...children.map((c) => layerOf.get(c)!)) - 1);
  }

  // 2. Slots: one per entity, plus a lane in every layer a long line crosses,
  // so no box is placed where that line has to pass.
  const layers: Slot[][] = [];
  const slots = new Map<string, Slot>();
  const put = (slot: Slot, layer: number): Slot => {
    (layers[layer] ??= []).push(slot);
    slots.set(slot.id, slot);
    return slot;
  };
  for (const e of entities) {
    put({ id: e.name, entity: e.name, ...sizeOf(e), upper: [], lower: [], x: 0 }, layerOf.get(e.name) ?? 0);
  }
  let lanes = 0;
  for (const [upper, lowers] of below) {
    for (const lower of lowers) {
      let prev = upper;
      for (let layer = layerOf.get(upper)! + 1; layer < layerOf.get(lower)!; layer++) {
        const lane = put({ id: `\u0000lane${lanes++}`, width: LANE_WIDTH, height: 0, upper: [], lower: [], x: 0 }, layer);
        slots.get(prev)!.lower.push(lane.id);
        lane.upper.push(prev);
        prev = lane.id;
      }
      slots.get(prev)!.lower.push(lower);
      slots.get(lower)!.upper.push(prev);
    }
  }
  // A layer every entity dropped out of is closed up, not left as a blank band.
  for (let i = layers.length - 1; i >= 0; i--) if (!layers[i]?.length) layers.splice(i, 1);

  // 3. Order within a layer by where the neighbours sit, swept down then up.
  const mean = (ids: string[], of: (s: Slot) => number): number | null =>
    ids.length ? ids.reduce((sum, id) => sum + of(slots.get(id)!), 0) / ids.length : null;
  const reorder = (layer: Slot[], side: "upper" | "lower"): void => {
    const index = new Map<string, number>();
    for (const row of layers) row.forEach((s, i) => index.set(s.id, i));
    const key = new Map(layer.map((s, i) => [s.id, mean(s[side], (n) => index.get(n.id)!) ?? i]));
    layer.sort((a, b) => key.get(a.id)! - key.get(b.id)!);
  };
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let i = 1; i < layers.length; i++) reorder(layers[i], "upper");
    for (let i = layers.length - 2; i >= 0; i--) reorder(layers[i], "lower");
  }

  // 4. Horizontal position: each slot centred on its neighbours where the order
  // allows, packed left to right; one pass down, one back up.
  const centre = (s: Slot): number => s.x + s.width / 2;
  const pack = (layer: Slot[], side: "upper" | "lower"): void => {
    let cursor = 0;
    for (const s of layer) {
      const wanted = mean(s[side], centre);
      s.x = Math.max(cursor, wanted === null ? cursor : wanted - s.width / 2);
      cursor = s.x + s.width + hSpacing;
    }
  };
  for (const layer of layers) pack(layer, "upper");
  for (let i = layers.length - 2; i >= 0; i--) pack(layers[i], "lower");

  const left = Math.min(0, ...[...slots.values()].map((s) => s.x));
  const boxes: Record<string, LayoutBox> = {};
  let y = 40;
  for (const layer of layers) {
    for (const s of layer) {
      if (s.entity) boxes[s.entity] = { x: Math.round(s.x - left) + 40, y, width: s.width, height: s.height };
    }
    y += Math.max(0, ...layer.map((s) => s.height)) + vSpacing;
  }
  return boxes;
}
