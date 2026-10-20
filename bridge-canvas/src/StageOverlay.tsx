/**
 * The stage's layer over a canvas (Spec 83) — any of the three boards, or any
 * host's board that shares a viewport.
 *
 * It never reaches into the canvas under it. It is told the viewport and where
 * the elements are (`machineElementBoxes`, `erdElementBoxes`,
 * `sequenceElementBoxes` from the protocol), and from those alone it:
 *
 * - **lights** what an agent points at: the rest of the drawing dims behind a
 *   scrim with a hole around each spotlighted element, and each hole is ringed;
 * - **frames** an area the agent names;
 * - **pins** each mark at what it points at, numbered, coloured by whether it
 *   waits (open), was answered, or is done — a tap opens its thread; a mark
 *   the host lists in `unread` (an agent's word not yet opened) wears a quiet
 *   "new" ring and dot;
 * - **takes a mark** when the host turns marking on: a tap names the element
 *   under it, a drag names the elements inside the area drawn (and the area).
 *   A mouse or pen tap on empty board marks a small area there; a finger's tap
 *   on empty board does nothing, so a phone's stray touch never makes a mark
 *   (a finger's drag still frames an area).
 *
 * Positioned over the canvas by the host (both in one `position: relative`
 * box); it lets every pointer through to the canvas except on its pins and
 * while marking.
 */
import { useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  boxesOf,
  elementAt,
  elementsInRegion,
  padBox,
  screenToWorld,
  unionBox,
  viewportTransform,
  worldToScreen,
  type Box,
  type ElementBox,
  type Mark,
  type Viewport,
} from "@miadi/stateloom-protocol";
import { themeStyle, type CanvasTheme } from "./theme.js";

/** What a person pointed at while marking, before they say anything about it. */
export interface MarkDraft {
  elements: string[];
  region?: Box;
}

export interface StageOverlayProps {
  viewport: Viewport;
  /** Where the drawn elements are, in the drawing's coordinates. */
  boxes: readonly ElementBox[];
  /** Elements to light; the rest dims. */
  spotlight?: readonly string[];
  /** An area to frame. */
  region?: Box | null;
  marks?: readonly Mark[];
  selectedMark?: string | null;
  onSelectMark?: (id: string) => void;
  /**
   * Marks with an agent's word the person has not opened yet (their ids): the
   * pin wears a quiet "new" ring. `unreadMarks(marks, read)` from the protocol,
   * with `read` from `useMarksRead`.
   */
  unread?: readonly string[];
  /** Resolved marks keep no pin. Default true. */
  hideResolved?: boolean;
  /** Take the next tap or drag as a mark. */
  marking?: boolean;
  onDraft?: (draft: MarkDraft) => void;
  /** A mark being written: its elements ringed, its area framed. */
  draft?: MarkDraft | null;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

/** Below this many screen pixels a press is a tap, not an area. */
const DRAG_THRESHOLD = 6;
/** A tap on empty board marks a square this many screen pixels wide around it. */
const TAP_AREA = 56;
const HOLE_PAD = 8;

/** Where a mark sits: its elements that are drawn here, else its area. */
export function markAnchor(mark: Pick<Mark, "elements" | "region">, boxes: readonly ElementBox[]): Box | null {
  const drawn = mark.elements?.length ? boxesOf(boxes, mark.elements) : [];
  return unionBox(drawn) ?? mark.region ?? null;
}

function pinTone(mark: Mark): string {
  if (mark.status === "resolved") return "resolved";
  if (mark.author.role === "agent") return mark.status === "answered" ? "answered" : "question";
  return mark.status === "answered" ? "answered" : "open";
}

export function StageOverlay({
  viewport,
  boxes,
  spotlight,
  region,
  marks,
  selectedMark = null,
  onSelectMark,
  unread,
  hideResolved = true,
  marking = false,
  onDraft,
  draft = null,
  theme,
  className,
  style,
}: StageOverlayProps) {
  const maskId = `slc-stage-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const holes = useMemo(() => (spotlight?.length ? boxesOf(boxes, spotlight).map((b) => padBox(b, HOLE_PAD)) : []), [boxes, spotlight]);
  const vt = viewportTransform(viewport);

  const selected = marks?.find((m) => m.id === selectedMark) ?? null;
  const unreadIds = useMemo(() => new Set(unread ?? []), [unread]);
  const ringed = useMemo(() => {
    const out: Box[] = [];
    if (selected?.elements?.length) out.push(...boxesOf(boxes, selected.elements));
    if (draft?.elements.length) out.push(...boxesOf(boxes, draft.elements));
    return out.map((b) => padBox(b, 4));
  }, [boxes, selected, draft]);
  const framed = [selected?.region, draft?.region].filter((b): b is Box => !!b);

  const pins = (marks ?? [])
    .map((m, i) => ({ mark: m, n: i + 1 }))
    .filter(({ mark }) => !(hideResolved && mark.status === "resolved" && mark.id !== selectedMark))
    .map(({ mark, n }) => {
      const at = markAnchor(mark, boxes);
      if (!at) return null;
      const p = worldToScreen(viewport, { x: at.x + at.width, y: at.y });
      return { mark, n, x: p.x, y: p.y };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const local = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    press.current = { id: e.pointerId, x: p.x, y: p.y, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = press.current;
    if (!s || s.id !== e.pointerId) return;
    const p = local(e);
    if (!s.moved && Math.hypot(p.x - s.x, p.y - s.y) < DRAG_THRESHOLD) return;
    s.moved = true;
    setDrag({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = press.current;
    if (!s || s.id !== e.pointerId) return;
    press.current = null;
    setDrag(null);
    const p = local(e);
    if (s.moved) {
      const a = screenToWorld(viewport, { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y) });
      const b = screenToWorld(viewport, { x: Math.max(s.x, p.x), y: Math.max(s.y, p.y) });
      const area = { x: a.x, y: a.y, width: Math.max(1, b.x - a.x), height: Math.max(1, b.y - a.y) };
      onDraft?.({ elements: elementsInRegion(boxes, area), region: area });
      return;
    }
    const w = screenToWorld(viewport, p);
    const hit = elementAt(boxes, w.x, w.y);
    if (hit) return onDraft?.({ elements: [hit] });
    // A finger's tap on empty board is a pan or a dismiss gone astray, not a mark.
    if (e.pointerType === "touch") return;
    const half = TAP_AREA / 2 / (viewport.scale || 1);
    onDraft?.({ elements: [], region: { x: w.x - half, y: w.y - half, width: half * 2, height: half * 2 } });
  };

  return (
    <div
      ref={rootRef}
      className={`slc-stage${marking ? " slc-stage--marking" : ""}${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
    >
      <svg className="slc-stage-svg" aria-hidden="true">
        {holes.length > 0 && (
          <>
            <defs>
              <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <g transform={vt}>
                  {holes.map((b, i) => (
                    <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx={10} fill="black" />
                  ))}
                </g>
              </mask>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" className="slc-stage-scrim" mask={`url(#${maskId})`} />
            <g transform={vt}>
              {holes.map((b, i) => (
                <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx={10} className="slc-stage-ring" vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </>
        )}
        <g transform={vt}>
          {region && (
            <rect x={region.x} y={region.y} width={region.width} height={region.height} rx={6} className="slc-stage-region" vectorEffect="non-scaling-stroke" />
          )}
          {ringed.map((b, i) => (
            <rect key={`r${i}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={8} className="slc-stage-mark-ring" vectorEffect="non-scaling-stroke" />
          ))}
          {framed.map((b, i) => (
            <rect key={`f${i}`} x={b.x} y={b.y} width={b.width} height={b.height} rx={4} className="slc-stage-mark-area" vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        {drag && <rect x={drag.x} y={drag.y} width={drag.w} height={drag.h} rx={4} className="slc-stage-drag" />}
      </svg>

      {pins.map(({ mark, n, x, y }) => (
        <button
          key={mark.id}
          type="button"
          className={`slc-stage-pin slc-stage-pin--${pinTone(mark)}${unreadIds.has(mark.id) ? " slc-stage-pin--new" : ""}${mark.id === selectedMark ? " slc-stage-pin--selected" : ""}`}
          style={{ left: x, top: y }}
          title={`${mark.author.name}: ${mark.text}${mark.replies?.length ? ` (${mark.replies.length} repl${mark.replies.length === 1 ? "y" : "ies"})` : ""}${unreadIds.has(mark.id) ? " · new" : ""}`}
          aria-label={`Mark ${n}, ${mark.status}${unreadIds.has(mark.id) ? ", new" : ""}: ${mark.text}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelectMark?.(mark.id);
          }}
        >
          {n}
          {(mark.replies?.length ?? 0) > 0 && <span className="slc-stage-pin-count">{mark.replies!.length}</span>}
        </button>
      ))}

      {marking && (
        <div
          className="slc-stage-catch"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            press.current = null;
            setDrag(null);
          }}
        />
      )}
    </div>
  );
}

export default StageOverlay;
