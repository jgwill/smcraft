/**
 * The ERD design surface (Spec 80) — the sibling of `<StateMachineCanvas>`.
 *
 * Same contract: props in, callbacks out, no store, no socket. The host owns
 * the definition, the box positions and the viewport; this component draws
 * them and reports what the hand did. Same gestures too — wheel pans, ⌃/⌘
 * wheel zooms at the pointer, a drag on the board pans, a drag on a box moves
 * it, two fingers pinch — and the same `--slc-*` variables, so a host that has
 * themed the state canvas has themed this one.
 *
 * An entity box lists its attributes; keys show as PK / UK / FK badges. An
 * attribute that stores a machine's state (`stateOf`) is drawn in the accent
 * ink with a ◉, and activating it reports the machine through
 * `onOpenMachine` — the join between the two diagrams.
 *
 * Relationship lines reuse the state canvas's edge router, so several lines on
 * one box face each get a port of their own. Each end carries its cardinality
 * mark: a bar for "one", a crow's foot for "many".
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ERD_BOX,
  erdRowText,
  fitToBoxes,
  panBy,
  placeLabels,
  routeEdges,
  screenDeltaToWorld,
  stateOfList,
  viewportTransform,
  zoomAt,
  type EdgePoint,
  type EntityRelationshipDefinition,
  type ErdAttribute,
  type ErdCardinality,
  type LayoutBox,
  type Viewport,
} from "@miadi/stateloom-protocol";
import { themeStyle, type CanvasTheme } from "./theme.js";

export interface ErdCanvasTarget {
  kind: "entity" | "canvas";
  id?: string;
}

export interface EntityRelationshipCanvasProps {
  definition: EntityRelationshipDefinition;
  /** Entity name → box. The host owns these; `erdAutoLayout` seeds them. */
  positions: Record<string, LayoutBox>;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  /** The selected entity's name. */
  selection?: string | null;
  /** Entities failing validation. */
  errorElements?: readonly string[];
  readOnly?: boolean;
  /** Change this to re-fit the board to its boxes (a new document, a re-layout). */
  fitKey?: string | number;
  onSelect?: (entity: string) => void;
  onClearSelection?: () => void;
  onEntityMove?: (name: string, box: LayoutBox) => void;
  /** An attribute that stores a machine's state was activated. */
  onOpenMachine?: (machine: string) => void;
  onContextMenu?: (clientX: number, clientY: number, target: ErdCanvasTarget) => void;
  emptyHint?: ReactNode;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
  svgId?: string;
}

const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 400;
/** Movement under this many screen pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;

function wheelPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * WHEEL_LINE_HEIGHT;
  if (mode === 2) return delta * WHEEL_PAGE_HEIGHT;
  return delta;
}

/** Which mark each end of a relationship carries: [from end, to end]. */
const ENDS: Record<ErdCardinality, ["one" | "many", "one" | "many"]> = {
  "1:1": ["one", "one"],
  "1:N": ["one", "many"],
  "N:1": ["many", "one"],
  "N:M": ["many", "many"],
};

/**
 * The cardinality mark at `tip` (the point on the box edge), for a line that
 * leaves toward `toward`. A bar for "one"; a crow's foot for "many", opening
 * onto the box.
 */
function endMark(tip: EdgePoint, toward: EdgePoint, kind: "one" | "many"): string {
  const dx = toward.x - tip.x;
  const dy = toward.y - tip.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const at = (along: number, across: number): string =>
    `${(tip.x + ux * along + nx * across).toFixed(1)} ${(tip.y + uy * along + ny * across).toFixed(1)}`;
  if (kind === "one") return `M ${at(9, 6)} L ${at(9, -6)}`;
  return `M ${at(13, 0)} L ${at(0, 7)} M ${at(13, 0)} L ${at(0, -7)} M ${at(13, 0)} L ${at(0, 0)}`;
}

const keyBadges = (attr: ErdAttribute): string =>
  [attr.key === "pk" ? "PK" : attr.key === "uk" ? "UK" : "", attr.references ? "FK" : ""].filter(Boolean).join(" ");

interface Gesture {
  kind: "pan" | "move";
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  name?: string;
  origin?: LayoutBox;
  moved: boolean;
}

export function EntityRelationshipCanvas({
  definition,
  positions,
  viewport,
  onViewportChange,
  selection = null,
  errorElements,
  readOnly = false,
  fitKey,
  onSelect,
  onClearSelection,
  onEntityMove,
  onOpenMachine,
  onContextMenu,
  emptyHint,
  theme,
  className,
  style,
  svgId,
}: EntityRelationshipCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, EdgePoint>());
  const pinchRef = useRef<{ distance: number; mid: EdgePoint } | null>(null);

  const entities = useMemo(() => {
    const seen = new Set<string>();
    return (definition.entities ?? []).filter((e) => {
      if (!e?.name || seen.has(e.name) || !positions[e.name]) return false;
      seen.add(e.name);
      return true;
    });
  }, [definition.entities, positions]);

  // Routed by index, not by name: the router keys its faces on a space-joined
  // string, and an entity may be called "Order Line".
  const edges = useMemo(() => {
    const indexOf = new Map(entities.map((e, i) => [e.name, `e${i}`]));
    const drawn = (definition.relationships ?? []).filter((r) => r && indexOf.has(r.from) && indexOf.has(r.to));
    const curves = routeEdges(
      drawn.map((r) => ({ from: indexOf.get(r.from)!, to: indexOf.get(r.to)! })),
      (id) => positions[entities[Number(id.slice(1))].name],
    );
    return drawn.map((rel, i) => ({ rel, curve: curves[i] }));
  }, [definition.relationships, entities, positions]);

  // The state canvas's chip placer: each label tries spots along its own line
  // until it is clear of every box and of the labels already down.
  const labels = useMemo(() => {
    const pending = edges
      .filter(({ rel }) => rel.label)
      .map(({ rel, curve }) => ({ event: rel.label!, at: curve.at }));
    return placeLabels(pending, entities.map((e) => positions[e.name]));
  }, [edges, entities, positions]);

  const toCanvasPoint = useCallback((clientX: number, clientY: number): EdgePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  // Fit on demand. Keyed rather than automatic so a box being dragged toward
  // the edge never makes the board jump under the hand.
  useEffect(() => {
    if (fitKey === undefined) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const boxes = Object.values(positions);
    if (!rect || boxes.length === 0) return;
    onViewportChange(fitToBoxes(boxes, rect.width, rect.height));
    // Positions are read at the moment of the fit, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Native, because React's wheel listener is passive and cannot stop the page
  // from zooming out from under the board.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = viewportRef.current;
      const dx = wheelPixels(e.deltaX, e.deltaMode);
      const dy = wheelPixels(e.deltaY, e.deltaMode);
      if (e.ctrlKey || e.metaKey) {
        onViewportChange(zoomAt(vp, Math.exp(-dy * 0.0025), toCanvasPoint(e.clientX, e.clientY)));
        return;
      }
      const moveX = e.shiftKey ? -(dx || dy) : -dx;
      const moveY = e.shiftKey ? 0 : -dy;
      if (moveX !== 0 || moveY !== 0) onViewportChange(panBy(vp, moveX, moveY));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [onViewportChange, toCanvasPoint]);

  const pinchState = (): { distance: number; mid: EdgePoint } | null => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { distance: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGElement>, name?: string): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, toCanvasPoint(e.clientX, e.clientY));
    if (pointersRef.current.size >= 2) {
      // A second finger turns whatever was happening into a pinch.
      gestureRef.current = null;
      pinchRef.current = pinchState();
      return;
    }
    const movable = name !== undefined && !readOnly;
    gestureRef.current = {
      kind: movable ? "move" : "pan",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      name,
      origin: movable ? positions[name] : undefined,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, toCanvasPoint(e.clientX, e.clientY));
    }
    if (pinchRef.current) {
      const next = pinchState();
      if (!next) return;
      const prev = pinchRef.current;
      const panned = panBy(viewportRef.current, next.mid.x - prev.mid.x, next.mid.y - prev.mid.y);
      onViewportChange(zoomAt(panned, next.distance / prev.distance, next.mid));
      pinchRef.current = next;
      return;
    }
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
    g.moved = true;
    if (g.kind === "pan") {
      onViewportChange(panBy(viewportRef.current, e.clientX - g.lastX, e.clientY - g.lastY));
    } else if (g.name && g.origin) {
      const d = screenDeltaToWorld(viewportRef.current, e.clientX - g.startX, e.clientY - g.startY);
      onEntityMove?.(g.name, { ...g.origin, x: g.origin.x + d.x, y: g.origin.y + d.y });
    }
    g.lastX = e.clientX;
    g.lastY = e.clientY;
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) pinchRef.current = null;
      return;
    }
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (g.moved) return;
    if (g.name) onSelect?.(g.name);
    else onClearSelection?.();
  };

  const errors = new Set(errorElements ?? []);

  return (
    <div className={`slc-pane${className ? ` ${className}` : ""}`} style={{ ...themeStyle(theme), ...style }}>
      <svg
        ref={svgRef}
        id={svgId}
        className="slc-surface"
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          if (!onContextMenu) return;
          e.preventDefault();
          onContextMenu(e.clientX, e.clientY, { kind: "canvas" });
        }}
      >
        <g transform={viewportTransform(viewport)}>
          {edges.map(({ rel, curve }, i) => {
            const [fromEnd, toEnd] = ENDS[rel.cardinality] ?? ENDS["1:N"];
            return (
              <g key={`r${i}`} className="slc-erd-rel">
                <path d={curve.path} className="slc-erd-line" />
                <path d={endMark(curve.p0, curve.p1, fromEnd)} className="slc-erd-mark" />
                <path d={endMark(curve.p3, curve.p2, toEnd)} className="slc-erd-mark" />
              </g>
            );
          })}

          {entities.map((entity) => {
            const box = positions[entity.name];
            const rows = (entity.attributes ?? []).filter((a) => a?.name);
            const isSelected = selection === entity.name;
            const boxClass = [
              "slc-node",
              isSelected ? "slc-node--selected" : "",
              errors.has(entity.name) ? "slc-node--error" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <g
                key={entity.name}
                className={readOnly ? "slc-node--static" : "slc-node--draggable"}
                onPointerDown={(e) => onPointerDown(e, entity.name)}
                onContextMenu={(e) => {
                  if (!onContextMenu) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu(e.clientX, e.clientY, { kind: "entity", id: entity.name });
                }}
              >
                {entity.description && <title>{entity.description}</title>}
                <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={6} className={boxClass} />
                <path
                  d={`M ${box.x} ${box.y + ERD_BOX.headerHeight} h ${box.width}`}
                  className="slc-erd-rule"
                />
                <text
                  x={box.x + box.width / 2}
                  y={box.y + ERD_BOX.headerHeight / 2 + 5}
                  textAnchor="middle"
                  className="slc-node-name"
                >
                  {entity.name}
                </text>
                {rows.length === 0 && (
                  <text x={box.x + ERD_BOX.padX} y={box.y + ERD_BOX.headerHeight + 15} className="slc-erd-row slc-erd-row--empty">
                    no attributes
                  </text>
                )}
                {rows.map((attr, r) => {
                  const y = box.y + ERD_BOX.headerHeight + r * ERD_BOX.rowHeight + 15;
                  const machines = stateOfList(attr);
                  const badges = keyBadges(attr);
                  return (
                    <g
                      key={attr.name}
                      className={machines.length && onOpenMachine ? "slc-erd-state" : undefined}
                      onPointerDown={machines.length && onOpenMachine ? (e) => e.stopPropagation() : undefined}
                      onClick={machines.length && onOpenMachine ? () => onOpenMachine(machines[0]) : undefined}
                    >
                      {(machines.length > 0 || attr.description) && (
                        <title>
                          {[machines.length ? `stores the state of ${machines.join(", ")}` : "", attr.description ?? ""]
                            .filter(Boolean)
                            .join(" — ")}
                        </title>
                      )}
                      <text
                        x={box.x + ERD_BOX.padX}
                        y={y}
                        className={`slc-erd-row${machines.length ? " slc-erd-row--state" : ""}${
                          attr.key === "pk" ? " slc-erd-row--pk" : ""
                        }`}
                      >
                        {machines.length ? "◉ " : ""}
                        {erdRowText(attr)}
                        {attr.nullable ? " ?" : ""}
                      </text>
                      {badges && (
                        <text x={box.x + box.width - ERD_BOX.padX} y={y} textAnchor="end" className="slc-erd-badge">
                          {badges}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {labels.map((spot, i) => (
            <g key={`l${i}`} pointerEvents="none">
              <rect x={spot.x} y={spot.y} width={spot.width} height={spot.height} rx={4} className="slc-chip-plate" />
              <text x={spot.cx} y={spot.cy - 5} textAnchor="middle" className="slc-erd-rel-label">
                {spot.label.event}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {entities.length === 0 && emptyHint && <div className="slc-erd-empty">{emptyHint}</div>}
    </div>
  );
}

export default EntityRelationshipCanvas;
