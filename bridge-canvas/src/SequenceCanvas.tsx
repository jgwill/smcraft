/**
 * The sequence design surface (Spec 81) — the third sibling of
 * `<StateMachineCanvas>` and `<EntityRelationshipCanvas>`.
 *
 * Same contract: props in, callbacks out, no store, no socket. The host owns
 * the definition and the viewport; the geometry is `sequenceLayout(def)`, which
 * the host may compute once and pass in so that its own "centre on message 9"
 * and this drawing agree to the pixel. Same gestures: wheel pans, ⌃/⌘ wheel
 * zooms at the pointer, a drag anywhere pans (nothing on a sequence is dragged
 * into place — the order IS the drawing), two fingers pinch. Same `--slc-*`
 * variables, so a themed host has themed this board too.
 *
 * What is drawn, from the layout:
 *
 * - a header box per participant. An actor (a participant that names a system
 *   actor) has rounded ends; an object participant (it IS a machine's object)
 *   has its name underlined, as UML writes an instance.
 * - a lifeline under each header.
 * - one arrow per message, headed by its ref and label. The event it fires is a
 *   small chip after the label, the state it leaves the machine in follows as
 *   `→ State`. A reply is dashed, an optional message is tagged `opt`, and a
 *   message to oneself is a loop to the right.
 * - each fragment as a frame below the main messages, headed
 *   `alt · after 11 · <label>`.
 *
 * Selection is by focus kind: `{ kind: "message", id: "9" }` or
 * `{ kind: "participant", id: "Chart" }` — the same names `focus=` uses.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  allMessages,
  fitToBoxes,
  panBy,
  sequenceLayout,
  textWidth,
  viewportTransform,
  zoomAt,
  type EdgePoint,
  type SequenceDefinition,
  type SequenceLayout,
  type SqdFragment,
  type SqdMessage,
  type SqdParticipant,
  type Viewport,
} from "@miadi/stateloom-protocol";
import { themeStyle, type CanvasTheme } from "./theme.js";

export type SequenceTargetKind = "message" | "participant";

export interface SequenceSelection {
  kind: SequenceTargetKind;
  /** A message ref (`"9"`, `"f1.2"`) or a participant name. */
  id: string;
}

export interface SequenceCanvasTarget {
  kind: SequenceTargetKind | "canvas";
  id?: string;
}

export interface SequenceCanvasProps {
  definition: SequenceDefinition;
  /** `sequenceLayout(definition)`. Computed here when omitted. */
  layout?: SequenceLayout;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  selection?: SequenceSelection | null;
  /** Elements failing a check, as focus strings: `message:9`, `participant:Chart`. */
  errorElements?: readonly string[];
  /** Elements with a warning (the replay's stops), drawn quieter than errors. */
  warningElements?: readonly string[];
  /** Change this to re-fit the board to the whole drawing. */
  fitKey?: string | number;
  onSelect?: (kind: SequenceTargetKind, id: string) => void;
  onClearSelection?: () => void;
  onContextMenu?: (clientX: number, clientY: number, target: SequenceCanvasTarget) => void;
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
const LABEL_SIZE = 11;
const CHIP_SIZE = 10;
const REF_SIZE = 10;
/** A self-message's loop: how far right it reaches and how tall it is. */
const LOOP_W = 30;
const LOOP_H = 14;

function wheelPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * WHEEL_LINE_HEIGHT;
  if (mode === 2) return delta * WHEEL_PAGE_HEIGHT;
  return delta;
}

/** A filled arrowhead with its tip at (x, y), pointing along +dx. */
function arrowHead(x: number, y: number, dir: 1 | -1, open: boolean): string {
  const back = x - dir * 9;
  return open ? `M ${back} ${y - 4.5} L ${x} ${y} L ${back} ${y + 4.5}` : `M ${back} ${y - 4.5} L ${x} ${y} L ${back} ${y + 4.5} Z`;
}

function participantTitle(p: SqdParticipant): string {
  return [
    p.actor ? `actor ${p.actor}` : p.object ? `object ${p.object}` : p.service ? `service ${p.service}` : "",
    p.holds?.length ? `holds ${p.holds.join(", ")}` : "",
    p.description ?? "",
    p.notes?.trim() ? `Notes: ${p.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function messageTitle(ref: string, m: SqdMessage): string {
  return [
    `${ref}. ${m.from} → ${m.to}: ${m.label}`,
    m.event ? `fires ${m.event}${m.machine ? ` on ${m.machine}` : ""}` : "",
    m.carries ? `carries ${m.carries}` : "",
    m.state ? `then ${m.state}` : "",
    m.optional ? "optional" : "",
    m.reply ? "reply" : "",
    m.description ?? "",
    m.notes?.trim() ? `Notes: ${m.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const text = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const optional = (v: unknown): string | undefined => text(v) || undefined;

function drawableMessage(m: unknown): SqdMessage {
  const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  return {
    from: text(o.from),
    to: text(o.to),
    label: text(o.label),
    event: optional(o.event),
    machine: optional(o.machine),
    carries: optional(o.carries),
    state: optional(o.state),
    description: optional(o.description),
    notes: optional(o.notes),
    optional: o.optional === true || undefined,
    reply: o.reply === true || undefined,
  };
}

/**
 * The sequence as this canvas draws it: every string a string, every list a
 * list, nothing null — so a malformed document draws what it can instead of
 * throwing. Positions are kept (a null message stays a row, an unnamed
 * participant a column) so refs and the layout still line up. Read-only: the
 * host's definition is never changed.
 */
export function drawableSequence(def: SequenceDefinition): SequenceDefinition {
  const d = (def && typeof def === "object" ? def : {}) as unknown as Record<string, unknown>;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const settings = (d.settings && typeof d.settings === "object" ? d.settings : {}) as Record<string, unknown>;
  return {
    settings: { namespace: text(settings.namespace), name: text(settings.name), notes: optional(settings.notes) },
    participants: list(d.participants).map((p) => {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return {
        name: text(o.name),
        description: optional(o.description),
        notes: optional(o.notes),
        actor: optional(o.actor),
        service: optional(o.service),
        object: optional(o.object),
        holds: Array.isArray(o.holds) ? o.holds.map(text) : typeof o.holds === "string" ? [o.holds] : undefined,
      };
    }),
    messages: list(d.messages).map(drawableMessage),
    ...(Array.isArray(d.fragments)
      ? {
          fragments: d.fragments.map((f) => {
            const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
            return {
              kind: text(o.kind) as SqdFragment["kind"],
              label: text(o.label),
              after: typeof o.after === "number" && Number.isFinite(o.after) ? o.after : 0,
              notes: optional(o.notes),
              messages: list(o.messages).map(drawableMessage),
            };
          }),
        }
      : {}),
  };
}

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  target?: SequenceSelection;
  moved: boolean;
}

export function SequenceCanvas({
  definition: given,
  layout: givenLayout,
  viewport,
  onViewportChange,
  selection = null,
  errorElements,
  warningElements,
  fitKey,
  onSelect,
  onClearSelection,
  onContextMenu,
  emptyHint,
  theme,
  className,
  style,
  svgId,
}: SequenceCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, EdgePoint>());
  const pinchRef = useRef<{ distance: number; mid: EdgePoint } | null>(null);

  // What is drawn: the document with every field read defensively — a
  // hand-written or agent-written file is not always the shape the types say.
  const definition = useMemo(() => drawableSequence(given), [given]);
  const layout = useMemo(() => givenLayout ?? sequenceLayout(definition), [givenLayout, definition]);

  // The words on each row, measured once drawn: an estimate places the event
  // chip after the label, the measure puts it right after it. Keyed `ref:part`.
  const textRefs = useRef(new Map<string, SVGTextElement>());
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const measureRef = (key: string) => (el: SVGTextElement | null) => {
    if (el) textRefs.current.set(key, el);
    else textRefs.current.delete(key);
  };
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    for (const [key, el] of textRefs.current) {
      const w = typeof el.getComputedTextLength === "function" ? el.getComputedTextLength() : 0;
      if (!w) continue;
      next[key] = w;
      if (Math.abs((measured[key] ?? -1) - w) > 0.5) changed = true;
    }
    if (changed) setMeasured(next);
    // Measured again whenever what is drawn changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, definition]);
  const messages = useMemo(() => new Map(allMessages(definition).map((m) => [m.ref, m.message])), [definition]);
  const participants = useMemo(
    () => new Map(definition.participants.filter((p) => p.name).map((p) => [p.name, p])),
    [definition.participants],
  );

  const toCanvasPoint = useCallback((clientX: number, clientY: number): EdgePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  // Fit on demand, as the other boards do.
  useEffect(() => {
    if (fitKey === undefined) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || layout.participants.length === 0) return;
    onViewportChange(fitToBoxes([{ x: 0, y: 0, width: layout.width, height: layout.height }], rect.width, rect.height, { padding: 16 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

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

  const onPointerDown = (e: ReactPointerEvent<SVGElement>, target?: SequenceSelection): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, toCanvasPoint(e.clientX, e.clientY));
    if (pointersRef.current.size >= 2) {
      gestureRef.current = null;
      pinchRef.current = pinchState();
      return;
    }
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      target,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, toCanvasPoint(e.clientX, e.clientY));
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
    onViewportChange(panBy(viewportRef.current, e.clientX - g.lastX, e.clientY - g.lastY));
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
    if (g.target) onSelect?.(g.target.kind, g.target.id);
    else onClearSelection?.();
  };

  const menu = (target: SequenceCanvasTarget) => (e: ReactMouseEvent) => {
    if (!onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e.clientX, e.clientY, target);
  };

  const errors = new Set(errorElements ?? []);
  const warnings = new Set(warningElements ?? []);
  const isSel = (kind: SequenceTargetKind, id: string) => selection?.kind === kind && selection.id === id;
  const selectedMessage = selection?.kind === "message" ? messages.get(selection.id) : undefined;

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
        onContextMenu={menu({ kind: "canvas" })}
      >
        <g transform={viewportTransform(viewport)}>
          {/* Fragment frames first, so the messages inside them paint on top. */}
          {layout.fragments.map((box) => {
            const f = definition.fragments?.[box.index];
            if (!f) return null;
            const heading = `${f.kind} · after ${f.after} · ${f.label}`;
            const tabW = textWidth(heading, LABEL_SIZE) + 18;
            const top = box.top;
            return (
              <g key={`f${box.index}`} className="slc-sqd-fragment">
                {f.notes?.trim() && <title>{`Notes: ${f.notes}`}</title>}
                <rect x={box.left} y={top} width={box.width} height={box.height} rx={3} className="slc-sqd-frame" />
                <path
                  d={`M ${box.left} ${top + 22} L ${box.left} ${top} L ${box.left + tabW} ${top} L ${box.left + tabW} ${top + 15} L ${box.left + tabW - 7} ${top + 22} Z`}
                  className="slc-sqd-frame-tab"
                />
                <text x={box.left + 8} y={top + 15} className="slc-sqd-frame-heading">
                  <tspan className="slc-sqd-frame-kind">{f.kind}</tspan>
                  {` · after ${f.after} · ${f.label}`}
                </text>
                {f.notes?.trim() && (
                  <rect x={box.left + tabW + 6} y={top + 7} width={13} height={5} rx={1.5} className="slc-note-mark" />
                )}
              </g>
            );
          })}

          {/* Lifelines, each a tap target for its participant. */}
          {layout.participants.map((box) => {
            const selected = isSel("participant", box.name);
            return (
              <g key={`l-${box.name}`} onPointerDown={(e) => onPointerDown(e, { kind: "participant", id: box.name })}>
                <path d={`M ${box.x} ${layout.lifelineTop} V ${layout.lifelineBottom}`} className="slc-sqd-hit" />
                <path
                  d={`M ${box.x} ${layout.lifelineTop} V ${layout.lifelineBottom}`}
                  className={`slc-sqd-lifeline${selected ? " slc-sqd-lifeline--selected" : ""}`}
                />
              </g>
            );
          })}

          {/* A dotted mark from the main message a fragment branches after, down to its frame. */}
          {layout.fragments.map((box) => {
            const f = definition.fragments?.[box.index];
            const anchor = f && f.after > 0 ? layout.rows.find((r) => r.fragment === null && r.index === f.after - 1) : undefined;
            if (!anchor) return null;
            const x = box.left + 4;
            return (
              <path
                key={`fa${box.index}`}
                d={`M ${Math.min(anchor.fromX, anchor.toX) - 14} ${anchor.y} H ${x} V ${box.top}`}
                className="slc-sqd-branch"
              />
            );
          })}

          {layout.rows.map((row) => {
            const m = messages.get(row.ref);
            if (!m) return null;
            const focus = `message:${row.ref}`;
            const selected = isSel("message", row.ref);
            const error = errors.has(focus);
            const warn = !error && warnings.has(focus);
            const lineClass = [
              "slc-sqd-line",
              m.reply ? "slc-sqd-line--reply" : "",
              m.optional ? "slc-sqd-line--optional" : "",
              error ? "slc-sqd-line--error" : warn ? "slc-sqd-line--warn" : "",
              selected ? "slc-sqd-line--selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const headClass = `slc-sqd-head${m.reply ? " slc-sqd-head--open" : ""}${
              selected ? " slc-sqd-head--selected" : error ? " slc-sqd-head--error" : ""
            }`;

            // The words, measured: ref, label, then the chips that follow it.
            const refText = row.ref;
            const refW = textWidth(refText, REF_SIZE) + 8;
            const labelW = measured[`${row.ref}:label`] ?? textWidth(m.label ?? "", LABEL_SIZE);
            const optW = m.optional ? textWidth("opt", CHIP_SIZE) + 8 : 0;
            const chipW = m.event ? (measured[`${row.ref}:event`] ?? m.event.length * 6.1) + 12 : 0;
            const stateText = m.state ? `→ ${m.state}` : "";
            const stateW = m.state ? (measured[`${row.ref}:state`] ?? textWidth(stateText, LABEL_SIZE)) : 0;
            const gap = 5;
            const total =
              refW + gap + labelW + (optW ? gap + optW : 0) + (chipW ? gap + chipW : 0) + (stateW ? gap + stateW : 0);

            let startX: number;
            let baseline: number;
            let geometry: ReactNode;
            let hit: { x: number; y: number; w: number; h: number };
            if (row.self) {
              const x = row.fromX;
              const top = row.y - LOOP_H / 2 - 2;
              const bottom = top + LOOP_H;
              geometry = (
                <>
                  <path d={`M ${x} ${top} H ${x + LOOP_W} V ${bottom} H ${x + 2}`} className={lineClass} />
                  <path d={arrowHead(x + 1, bottom, -1, !!m.reply)} className={headClass} />
                </>
              );
              startX = x + LOOP_W + 8;
              baseline = row.y + 2;
              hit = { x: x - 6, y: top - 8, w: LOOP_W + 14 + total, h: LOOP_H + 16 };
            } else {
              const dir: 1 | -1 = row.toX >= row.fromX ? 1 : -1;
              const lineEnd = row.toX - dir * 1;
              geometry = (
                <>
                  <path d={`M ${row.fromX} ${row.y} H ${lineEnd}`} className={lineClass} />
                  <path d={arrowHead(lineEnd, row.y, dir, !!m.reply)} className={headClass} />
                </>
              );
              const mid = (row.fromX + row.toX) / 2;
              startX = mid - total / 2;
              baseline = row.y - 6;
              const left = Math.min(row.fromX, row.toX, startX);
              const right = Math.max(row.fromX, row.toX, startX + total);
              hit = { x: left - 4, y: row.y - 22, w: right - left + 8, h: 30 };
            }

            let cursor = startX;
            const place = (w: number): number => {
              const at = cursor;
              cursor += w + gap;
              return at;
            };
            const refX = place(refW);
            const labelX = place(labelW);
            const optX = optW ? place(optW) : 0;
            const chipX = chipW ? place(chipW) : 0;
            const stateX = stateW ? place(stateW) : 0;

            return (
              <g
                key={`m-${row.ref}`}
                className="slc-sqd-message"
                onPointerDown={(e) => onPointerDown(e, { kind: "message", id: row.ref })}
                onContextMenu={menu({ kind: "message", id: row.ref })}
              >
                <title>{messageTitle(row.ref, m)}</title>
                <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} className="slc-sqd-hitbox" />
                {selected && <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} rx={4} className="slc-sqd-selected-plate" />}
                {geometry}
                <rect x={refX} y={baseline - 10} width={refW - 2} height={13} rx={6.5} className={`slc-sqd-ref-plate${selected ? " slc-sqd-ref-plate--selected" : ""}`} />
                <text x={refX + (refW - 2) / 2} y={baseline} textAnchor="middle" className="slc-sqd-ref">
                  {refText}
                </text>
                <text ref={measureRef(`${row.ref}:label`)} x={labelX} y={baseline} className={`slc-sqd-label${selected ? " slc-sqd-label--selected" : ""}${error ? " slc-sqd-label--error" : ""}`}>
                  {m.label}
                </text>
                {optW > 0 && (
                  <>
                    <rect x={optX} y={baseline - 10} width={optW} height={13} rx={3} className="slc-sqd-opt" />
                    <text x={optX + optW / 2} y={baseline - 0.5} textAnchor="middle" className="slc-sqd-opt-text">
                      opt
                    </text>
                  </>
                )}
                {chipW > 0 && (
                  <>
                    <rect x={chipX} y={baseline - 10.5} width={chipW} height={14} rx={7} className="slc-sqd-event" />
                    <text ref={measureRef(`${row.ref}:event`)} x={chipX + chipW / 2} y={baseline - 0.5} textAnchor="middle" className="slc-sqd-event-text">
                      {m.event}
                    </text>
                  </>
                )}
                {stateW > 0 && (
                  <text ref={measureRef(`${row.ref}:state`)} x={stateX} y={baseline} className="slc-sqd-state">
                    {stateText}
                  </text>
                )}
                {m.notes?.trim() && (
                  <rect x={cursor - gap + 3} y={baseline - 9} width={5} height={11} rx={1.5} className="slc-note-mark" />
                )}
              </g>
            );
          })}

          {layout.participants.map((box) => {
            const p = participants.get(box.name);
            if (!p) return null;
            const focus = `participant:${box.name}`;
            const selected = isSel("participant", box.name) || (!!selectedMessage && (selectedMessage.from === box.name || selectedMessage.to === box.name));
            const cls = [
              "slc-node",
              "slc-sqd-header",
              isSel("participant", box.name) ? "slc-node--selected" : selected ? "slc-sqd-header--involved" : "",
              errors.has(focus) ? "slc-node--error" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const kind = p.actor ? "actor" : p.object ? "object" : p.service ? "service" : "";
            return (
              <g
                key={`p-${box.name}`}
                className="slc-node--static slc-sqd-participant"
                onPointerDown={(e) => onPointerDown(e, { kind: "participant", id: box.name })}
                onContextMenu={menu({ kind: "participant", id: box.name })}
              >
                {participantTitle(p) && <title>{participantTitle(p)}</title>}
                <rect
                  x={box.left}
                  y={box.top}
                  width={box.width}
                  height={box.height}
                  rx={p.actor ? box.height / 2 : 4}
                  className={cls}
                />
                {p.notes?.trim() && (
                  <rect x={box.left + box.width - 24} y={box.top - 5} width={13} height={5} rx={1.5} className="slc-note-mark" />
                )}
                <text
                  x={box.x}
                  y={box.top + box.height / 2 + (kind ? 1 : 4)}
                  textAnchor="middle"
                  className={`slc-node-name slc-sqd-name${p.object ? " slc-sqd-name--object" : ""}`}
                >
                  {box.name}
                </text>
                {kind && (
                  <text x={box.x} y={box.top + box.height - 4} textAnchor="middle" className="slc-sqd-kind">
                    {kind === "object" ? `:${p.object}` : kind === "service" ? "service" : "actor"}
                    {p.holds?.length ? ` · holds ${p.holds.length}` : ""}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {layout.participants.length === 0 && emptyHint && <div className="slc-erd-empty">{emptyHint}</div>}
    </div>
  );
}

export default SequenceCanvas;
