/**
 * Chen notation geometry — where an entity's rectangle and its attribute ovals
 * sit inside the box the layout gives the entity. Pure.
 *
 * The rectangle is centred in the box and the ovals stand in two columns, left
 * and right of it, first half left, second half right, so the attribute order
 * of the document still reads top to bottom. Columns rather than a ring on
 * purpose: relationship lines in this layout leave an entity upward or
 * downward, so keeping the ovals strictly to the sides means a line never has
 * to cross one. `routingBox` is the corridor those lines attach to — as wide as
 * the rectangle, as tall as the whole box — so a line starts clear of the ovals
 * even when the columns are taller than the rectangle.
 *
 * An oval shows the attribute's name only, which is what Chen draws. Nothing
 * is lost: type, keys and the rest stay in the document, and the canvas puts
 * them in the oval's tooltip.
 */
import type { LayoutBox } from "../autoLayout.js";
import type { ErdAttribute, ErdEntity } from "./definition.js";

export const CHEN = {
  rectHeight: 40,
  rectMinWidth: 110,
  rectCharWidth: 8.4,
  rectPadX: 18,
  ovalRy: 13,
  ovalMinRx: 38,
  ovalCharWidth: 3.5,
  ovalPadX: 14,
  /** Vertical distance between two ovals in a column. */
  pitch: 32,
  /** Horizontal distance between the rectangle and the near edge of an oval. */
  gap: 34,
  diamondMinHalfWidth: 34,
  diamondCharWidth: 3.7,
  diamondHalfHeight: 18,
} as const;

export interface ChenOval {
  attribute: ErdAttribute;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Where its connecting line meets the rectangle. */
  from: { x: number; y: number };
  /** Where that line meets the oval. */
  to: { x: number; y: number };
}

export interface ChenGeometry {
  rect: LayoutBox;
  ovals: ChenOval[];
  /** What relationship lines attach to: the rectangle's width, the whole box's height. */
  routingBox: LayoutBox;
}

const namedAttributes = (entity: ErdEntity): ErdAttribute[] => (entity.attributes ?? []).filter((a) => a?.name);

function rectWidth(entity: ErdEntity): number {
  return Math.max(CHEN.rectMinWidth, Math.ceil((entity.name ?? "").length * CHEN.rectCharWidth + CHEN.rectPadX * 2));
}

/** One oval width per entity — uniform ovals read as a set. */
function ovalRx(attributes: ErdAttribute[]): number {
  const longest = Math.max(0, ...attributes.map((a) => a.name.length));
  return Math.max(CHEN.ovalMinRx, Math.ceil(longest * CHEN.ovalCharWidth + CHEN.ovalPadX));
}

/** How many ovals go in the left column; the rest go right. */
const leftCount = (n: number): number => Math.ceil(n / 2);

/** The box an entity needs in Chen notation — what the layout reserves for it. */
export function erdChenFootprint(entity: ErdEntity): { width: number; height: number } {
  const attributes = namedAttributes(entity);
  const width = rectWidth(entity);
  if (attributes.length === 0) return { width, height: CHEN.rectHeight };
  const side = CHEN.gap + ovalRx(attributes) * 2;
  return {
    // A single attribute still reserves both sides, so the rectangle stays centred in its box.
    width: width + side * 2,
    height: Math.max(CHEN.rectHeight, leftCount(attributes.length) * CHEN.pitch),
  };
}

export function erdChenGeometry(entity: ErdEntity, box: LayoutBox): ChenGeometry {
  const attributes = namedAttributes(entity);
  const width = rectWidth(entity);
  const rect: LayoutBox = {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - CHEN.rectHeight) / 2,
    width,
    height: CHEN.rectHeight,
  };
  const rx = ovalRx(attributes);
  const midY = rect.y + rect.height / 2;
  const left = leftCount(attributes.length);

  const ovals = attributes.map((attribute, i): ChenOval => {
    const onLeft = i < left;
    const column = onLeft ? left : attributes.length - left;
    const row = onLeft ? i : i - left;
    const cy = midY + (row - (column - 1) / 2) * CHEN.pitch;
    const cx = onLeft ? rect.x - CHEN.gap - rx : rect.x + rect.width + CHEN.gap + rx;
    return {
      attribute,
      cx,
      cy,
      rx,
      ry: CHEN.ovalRy,
      from: { x: onLeft ? rect.x : rect.x + rect.width, y: midY },
      to: { x: onLeft ? cx + rx : cx - rx, y: cy },
    };
  });

  return { rect, ovals, routingBox: { x: rect.x, y: box.y, width: rect.width, height: box.height } };
}

/** Half-width of the diamond that carries a relationship's verb. */
export function chenDiamondHalfWidth(label: string): number {
  return Math.max(CHEN.diamondMinHalfWidth, Math.ceil(label.length * CHEN.diamondCharWidth + 18));
}

/** What Chen writes beside each end of a relationship: [from end, to end]. */
export function chenCardinalityText(cardinality: string): [string, string] {
  switch (cardinality) {
    case "1:1":
      return ["1", "1"];
    case "N:1":
      return ["N", "1"];
    case "N:M":
      return ["M", "N"];
    default:
      return ["1", "N"];
  }
}
