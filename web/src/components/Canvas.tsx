"use client";

import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import {
  IDENTITY_VIEWPORT,
  VIEWPORT_LIMITS,
  fitToBoxes,
  panBy,
  viewportTransform,
  zoomAt,
  zoomTo,
} from "@miadi/stateloom-react";
import type { Viewport } from "@miadi/stateloom-react";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { ContextMenuState } from "@/store/useDesignerStore";
import { CANVAS_PINCH_OWNER } from "@/lib/gestureOwner";
import { useLayoutMemory } from "@/lib/layoutMemory";
import type { StatePosition, StateDef } from "@/types/definition";

interface DragState {
  name: string;
  /** Which pointer owns this drag — a second finger must not end it. */
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

/** A pan in progress: where the pointer went down and where the view was then. */
interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

/**
 * Two fingers steering the view at once. Everything is measured against the
 * frame the gesture *started* in — the distance, the midpoint, the viewport —
 * so the transform is recomputed from scratch on every move instead of
 * accumulating, and a pinch can never drift away from the fingers holding it.
 */
interface PinchState {
  a: number;
  b: number;
  /** Screen distance between the fingers when the pinch began. Never zero. */
  startDist: number;
  /** Canvas-relative midpoint when it began — the point the zoom is anchored to. */
  startMidX: number;
  startMidY: number;
  start: Viewport;
}

/** A finger resting still, on its way to becoming the context menu. */
interface LongPressState {
  pointerId: number;
  x: number;
  y: number;
  target: ContextMenuState["target"];
  timer: ReturnType<typeof setTimeout>;
}

/** Wheel notches arrive in three units; normalise them to pixels. */
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 400;

/** How long a finger must rest in place before the press becomes a menu. */
const LONG_PRESS_MS = 500;
/**
 * How far a finger may wander and still count as resting. It doubles as the
 * line between a pan and a tap: a fingertip never lands perfectly still, and a
 * one-pixel tremor must not swallow the tap that clears the selection.
 */
const TOUCH_SLOP_PX = 8;
/** Screen-space cuff added around a box so a fingertip (~9mm) can find it. */
const TOUCH_TARGET_PAD_PX = 10;
/** Screen-space width of the invisible ribbon that catches a tap on an edge. */
const TOUCH_EDGE_STROKE_PX = 28;

function wheelPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * WHEEL_LINE_HEIGHT;
  if (mode === 2) return delta * WHEEL_PAGE_HEIGHT;
  return delta;
}

/**
 * Space is a pan modifier on the canvas and a plain space bar everywhere else —
 * a name being typed in a panel, or a focused button waiting to be pressed,
 * must never make the board slide.
 */
function isTypingTarget(node: EventTarget | null): boolean {
  const el = node as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION"].includes(el.tagName);
}

export default function Canvas() {
  const definition = useDesignerStore((s) => s.definition);
  const layout = useDesignerStore((s) => s.layout);
  const selection = useDesignerStore((s) => s.selection);
  const select = useDesignerStore((s) => s.select);
  const clearSelection = useDesignerStore((s) => s.clearSelection);
  const setStatePosition = useDesignerStore((s) => s.setStatePosition);
  const drawMode = useDesignerStore((s) => s.drawMode);
  const drawSource = useDesignerStore((s) => s.drawSource);
  const setDrawSource = useDesignerStore((s) => s.setDrawSource);
  const setDrawMode = useDesignerStore((s) => s.setDrawMode);
  const addTransition = useDesignerStore((s) => s.addTransition);
  const showContextMenu = useDesignerStore((s) => s.showContextMenu);
  const removeState = useDesignerStore((s) => s.removeState);
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const errors = useDesignerStore((s) => s.errors);
  const navigationPath = useDesignerStore((s) => s.navigationPath);
  const currentParent = useDesignerStore((s) => s.currentParent);
  const navigateInto = useDesignerStore((s) => s.navigateInto);
  const navigateUp = useDesignerStore((s) => s.navigateUp);
  const getCurrentChildren = useDesignerStore((s) => s.getCurrentChildren);
  const activeStates = useDesignerStore((s) => s.activeStates);
  const viewport = useDesignerStore((s) => s.viewport);
  const setViewport = useDesignerStore((s) => s.setViewport);

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // The same truth as `drag`, readable by a handler that may run before the
  // render carrying it — a second finger, or a lift, can arrive inside the frame
  // the press started in, and must still know which pointer owns the box.
  const dragRef = useRef<DragState | null>(null);
  const applyDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);
  const [eventPicker, setEventPicker] = useState<{ stateName: string; targetName: string; x: number; y: number } | null>(null);

  // Navigation. `spaceHeld` / `panning` drive the cursor (they must re-render);
  // the refs carry the same truth into native listeners and pointer handlers
  // that would otherwise close over a stale value.
  const spaceRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panRef = useRef<PanState | null>(null);
  const [panning, setPanning] = useState(false);
  // A pan that actually moved must not end as a click that clears the selection.
  const panMovedRef = useRef(false);
  // Who holds each live pointer, keyed by id, so it can be released again. A map
  // rather than a single slot: with two fingers down, one box can be holding the
  // first while the surface holds the second, and releasing the wrong one strands
  // the gesture.
  const capturesRef = useRef<Map<number, Element>>(new Map());

  // Touch. Every finger currently on the canvas, in the order it landed — the
  // map is what makes a *second* finger legible as a pinch rather than as a
  // second, competing drag.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const [pinching, setPinching] = useState(false);
  const longPressRef = useRef<LongPressState | null>(null);
  // A press that became a menu must not also read as a click: the shell hides
  // the menu on any click that reaches it, closing it on the way back up.
  const suppressClickRef = useRef(false);
  // Coarse pointer: hit areas grow for a fingertip, and only then, so a mouse
  // keeps the precision the visual design was drawn for. Resolved in an effect
  // (never during render) so the server's HTML and the first client paint agree.
  const [coarsePointer, setCoarsePointer] = useState(false);

  // While the view is being steered — dragged by a finger, pinched, or panned
  // with the middle button — the board underneath stops answering the pointer,
  // so a box never fights the gesture that is moving the whole world.
  const navigating = panning || pinching;

  // Remembered board: restore this browser's drags, then keep writing them back.
  useLayoutMemory();

  /** Pointer position relative to the canvas element — the space zoom anchors in. */
  const toCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  /** Hand the pointer back to whoever was holding it, and forget the holder. */
  const releaseCapture = useCallback((pointerId: number) => {
    const held = capturesRef.current.get(pointerId) as (Element & {
      hasPointerCapture?: (id: number) => boolean;
      releasePointerCapture?: (id: number) => void;
    }) | undefined;
    capturesRef.current.delete(pointerId);
    if (held?.hasPointerCapture?.(pointerId)) held.releasePointerCapture?.(pointerId);
  }, []);

  /** Disarm the pending menu — for one pointer, or for whichever is armed. */
  const cancelLongPress = useCallback((pointerId?: number) => {
    const held = longPressRef.current;
    if (!held) return;
    if (pointerId !== undefined && held.pointerId !== pointerId) return;
    clearTimeout(held.timer);
    longPressRef.current = null;
  }, []);

  /**
   * Arm the hold that stands in for a right-click. The finger keeps whatever it
   * already started — a drag, a pan — until the timer fires; only then does the
   * gesture let go, so the board cannot slide out from under the menu.
   */
  const armLongPress = useCallback(
    (e: React.PointerEvent, target: ContextMenuState["target"]) => {
      if (e.pointerType !== "touch") return;
      cancelLongPress();
      const { pointerId, clientX: x, clientY: y } = e;
      const timer = setTimeout(() => {
        longPressRef.current = null;
        applyDrag(null);
        panRef.current = null;
        setPanning(false);
        // The capture stays where it is: the finger now steers nothing, but the
        // element holding it is still guaranteed to receive the eventual lift.
        suppressClickRef.current = true;
        navigator.vibrate?.(10);
        showContextMenu(x, y, target);
      }, LONG_PRESS_MS);
      longPressRef.current = { pointerId, x, y, target, timer };
    },
    [cancelLongPress, showContextMenu, applyDrag]
  );

  // A fingertip asks for room a cursor does not. Detected once, watched for
  // change (a tablet docking to a mouse flips this), and never read in render
  // before the effect has run — so hydration matches the server's `false`.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarsePointer(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Safety net. Pointer capture makes the canvas's own `pointerup` reliable, but
  // a gesture torn away by the OS — a call arriving, the app backgrounded — can
  // still leave a finger recorded that is no longer on the glass. A stale entry
  // would make the *next* single touch look like the second half of a pinch, so
  // every pointer that ends anywhere is forgotten here too.
  useEffect(() => {
    const forget = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
    };
    window.addEventListener("pointerup", forget);
    window.addEventListener("pointercancel", forget);
    return () => {
      window.removeEventListener("pointerup", forget);
      window.removeEventListener("pointercancel", forget);
    };
  }, []);

  // Unmounting mid-hold must not leave a timer alive to open a menu over a
  // canvas that no longer exists.
  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

  // WS7b — live-animation tracking. The prev* refs are read/written ONLY inside
  // the commit effect (never during render). The rendered classes are driven by
  // state (enteringNames / enteringEdges), so the render stays a pure function
  // of props+state. `exitingNodes` holds nodes that vanished from the current
  // drill level so they outlive React's unmount and animate out.
  const prevNamesRef = useRef<Set<string>>(new Set());
  const prevNodeDataRef = useRef<Map<string, { state: StateDef; pos: StatePosition }>>(new Map());
  const prevParentRef = useRef<string>(currentParent);
  const prevEdgeKeysRef = useRef<Set<string>>(new Set());
  const [enteringNames, setEnteringNames] = useState<Set<string>>(new Set());
  const [enteringEdges, setEnteringEdges] = useState<Set<string>>(new Set());
  const [exitingNodes, setExitingNodes] = useState<Map<string, { state: StateDef; pos: StatePosition }>>(new Map());

  // Show only children of current navigation level (not flattened)
  const currentChildren = getCurrentChildren();
  const allEvents = definition.events.flatMap((src) => src.events ?? []);

  // Touch hit areas. Both live in world units — everything inside the navigated
  // group does — so each is a screen-pixel budget divided by the scale: the cuff
  // around a box and the ribbon along an edge stay the same size *in the hand*
  // whether the board is zoomed in or pushed away. Zero for a mouse, which means
  // the extra geometry is never rendered at all and the cursor keeps hitting
  // exactly what it is pointed at.
  const touchPad = coarsePointer ? TOUCH_TARGET_PAD_PX / viewport.scale : 0;
  const touchEdgeStroke = coarsePointer ? TOUCH_EDGE_STROKE_PX / viewport.scale : 0;
  /** HUD buttons in screen space: a thumb needs the padding a cursor does not. */
  const hudButton = coarsePointer ? "px-3 py-2" : "px-1.5 py-0.5";

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
      if (e.key === "Escape") { setDrawMode("select"); setEventPicker(null); }
      if (e.key === "Delete" && selection.kind === "state" && selection.id) {
        removeState(selection.id);
        clearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, setDrawMode, selection, removeState, clearSelection]);

  const getPos = useCallback(
    (name: string): StatePosition =>
      layout.positions[name] ?? { x: 100, y: 100, width: 160, height: 60 },
    [layout]
  );

  const hasError = useCallback(
    (name: string) => errors.some((e) => e.element === name),
    [errors]
  );

  /** Begin sliding the whole board with one pointer. Shared by mouse and finger. */
  const beginPan = useCallback((e: React.PointerEvent) => {
    const vp = useDesignerStore.getState().viewport;
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: vp.x,
      origY: vp.y,
    };
    panMovedRef.current = false;
    setPanning(true);
    const svg = svgRef.current;
    if (!svg) return;
    capturesRef.current.set(e.pointerId, svg);
    svg.setPointerCapture(e.pointerId);
  }, []);

  /**
   * Promote whatever is happening to a two-finger gesture. Everything the single
   * pointer had claimed — a box mid-drag, a pan mid-slide, a hold on its way to
   * a menu — is given up here: with both fingers on the glass the user is
   * steering the view, not editing the machine.
   */
  const beginPinch = useCallback(() => {
    const live = [...pointersRef.current.entries()];
    if (live.length < 2) return;
    const [[idA, a], [idB, b]] = live;

    cancelLongPress();
    applyDrag(null);
    panRef.current = null;

    // Fingers landing on the same pixel would divide by zero; a floor of one
    // pixel makes the first frame a no-op instead of an infinity.
    const startDist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const mid = toCanvasPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchRef.current = {
      a: idA,
      b: idB,
      startDist,
      startMidX: mid.x,
      startMidY: mid.y,
      start: useDesignerStore.getState().viewport,
    };
    // A pinch has plainly travelled; its lift is never a tap on empty space.
    panMovedRef.current = true;
    setPinching(true);

    // A finger that arrived while the capture phase was swallowing the event was
    // never captured by anyone. Take it on the surface so the gesture survives it
    // sliding off the canvas; fingers already held by a box keep that holder,
    // since their moves bubble here regardless.
    const svg = svgRef.current;
    if (!svg) return;
    for (const id of [idA, idB]) {
      if (capturesRef.current.has(id)) continue;
      try {
        svg.setPointerCapture(id);
        capturesRef.current.set(id, svg);
      } catch {
        // The pointer ended between the event and this line. Nothing to hold.
      }
    }
  }, [cancelLongPress, toCanvasPoint, applyDrag]);

  /**
   * Runs before any box or the surface sees the press, so it can count fingers
   * that a node's `stopPropagation` would otherwise hide. Bookkeeping only —
   * except for the one decision that has to be made this early: a second finger
   * turns the gesture into a pinch, and nothing below may start a rival one.
   */
  const handlePointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      // The click that closes out the previous gesture has been and gone (or was
      // never sent, as on iOS after a hold). Either way, stop swallowing.
      suppressClickRef.current = false;
      if (e.pointerType !== "touch") return;
      setCoarsePointer(true);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const count = pointersRef.current.size;
      if (count < 2) return;
      e.stopPropagation();
      if (count === 2) beginPinch();
      // A third finger is noise: recorded so its lift is accounted for, but the
      // pinch keeps the two fingers it started with.
    },
    [beginPinch]
  );

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, name: string) => {
      // Middle button, or space held: this gesture belongs to the surface. Let
      // it bubble un-stopped so the pan handler below picks it up.
      if (e.button !== 0 || spaceRef.current) return;
      e.stopPropagation();
      // A finger on a box may still be asking for the menu rather than a drag.
      // Arm the hold either way; travel past the slop disarms it.
      armLongPress(e, { kind: "state", id: name });
      if (drawMode === "transition") {
        if (!drawSource) {
          setDrawSource(name);
        } else if (drawSource !== name) {
          // Show event picker
          setEventPicker({ stateName: drawSource, targetName: name, x: e.clientX, y: e.clientY });
        }
        return;
      }
      select("state", name);
      const pos = getPos(name);
      applyDrag({ name, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y });
      // Capture on the node's own group, so the gesture survives the pointer
      // outrunning the box or leaving the canvas. It must be *this* element and
      // not the surface: a capture retargets the click and dblclick that follow,
      // and retargeting them to the <svg> would read as a click on empty space —
      // clearing the selection the press just made, and stealing the
      // double-click that drills into a composite.
      const node = e.currentTarget as Element;
      capturesRef.current.set(e.pointerId, node);
      node.setPointerCapture?.(e.pointerId);
    },
    [select, getPos, drawMode, drawSource, setDrawSource, armLongPress, applyDrag]
  );

  const handleSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "touch") {
        // A phone has no middle button and no space bar, so the plainest gesture
        // has to be the one that moves the board: one finger on bare canvas pans.
        // No `preventDefault` — the click and double-click synthesised from this
        // touch are what still clear the selection and drill into a composite.
        armLongPress(e, { kind: "canvas" });
        beginPan(e);
        return;
      }
      const wantsPan = e.button === 1 || (e.button === 0 && spaceRef.current);
      if (!wantsPan) return;
      // Suppresses the compatibility mouse events, and with them Chrome's
      // middle-click autoscroll.
      e.preventDefault();
      beginPan(e);
    },
    [armLongPress, beginPan]
  );

  const handleSurfacePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // A hold that wanders is a drag changing its mind.
      const hold = longPressRef.current;
      if (hold && hold.pointerId === e.pointerId) {
        if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > TOUCH_SLOP_PX) {
          cancelLongPress(e.pointerId);
        }
      }

      const pinch = pinchRef.current;
      if (pinch) {
        if (e.pointerId !== pinch.a && e.pointerId !== pinch.b) return;
        const a = pointersRef.current.get(pinch.a);
        const b = pointersRef.current.get(pinch.b);
        if (!a || !b) return;
        // Two fingers say two things at once, and the viewport has room for
        // both. The spread says how much to magnify: scale is the starting
        // scale times how much further apart the fingers are now. The midpoint
        // says where: `zoomTo` re-anchors the board so the world point that sat
        // under the *starting* midpoint is still under it after the rescale —
        // the same invariant Ctrl+wheel uses, with the midpoint standing in for
        // the cursor. Whatever the midpoint itself has travelled since is then
        // a plain screen-space slide, which is exactly a pan. Both are measured
        // from the gesture's opening frame, never from the previous move, so
        // rounding cannot accumulate under a long pinch.
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = toCanvasPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const zoomed = zoomTo(
          pinch.start,
          pinch.start.scale * (dist / pinch.startDist),
          { x: pinch.startMidX, y: pinch.startMidY }
        );
        setViewport(panBy(zoomed, mid.x - pinch.startMidX, mid.y - pinch.startMidY));
        return;
      }

      const pan = panRef.current;
      if (pan) {
        if (pan.pointerId !== e.pointerId) return;
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;
        // A mouse that moved at all was dragged. A fingertip is never that
        // still, so a touch has to clear the slop before its lift stops
        // counting as a tap.
        const slop = e.pointerType === "touch" ? TOUCH_SLOP_PX : 0;
        if (Math.abs(dx) > slop || Math.abs(dy) > slop) panMovedRef.current = true;
        const scale = useDesignerStore.getState().viewport.scale;
        setViewport({ x: pan.origX + dx, y: pan.origY + dy, scale });
        return;
      }
      if (!drag || drag.pointerId !== e.pointerId) return;
      // The pointer moves in screen pixels; the box lives in world units. At
      // scale k a screen pixel is 1/k world units, which is what keeps a
      // dragged state pinned under the cursor at any zoom. Pan cancels out of a
      // delta, so only the scale appears here.
      const scale = useDesignerStore.getState().viewport.scale;
      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;
      const pos = getPos(drag.name);
      setStatePosition(drag.name, {
        ...pos,
        x: Math.max(0, drag.origX + dx),
        y: Math.max(0, drag.origY + dy),
      });
    },
    [drag, getPos, setStatePosition, setViewport, cancelLongPress, toCanvasPoint]
  );

  const handleSurfacePointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      cancelLongPress(e.pointerId);
      releaseCapture(e.pointerId);

      const pinch = pinchRef.current;
      if (pinch && (pinch.a === e.pointerId || pinch.b === e.pointerId)) {
        pinchRef.current = null;
        setPinching(false);
        // One finger lifting out of a pinch leaves the other still on the glass,
        // and a hand that is still touching the board expects it to keep
        // following. Re-open a pan from where that finger is *now*, against the
        // viewport the pinch just left behind — measuring from where it first
        // landed would snap the board across the screen.
        const survivorId = pinch.a === e.pointerId ? pinch.b : pinch.a;
        const survivor = pointersRef.current.get(survivorId);
        if (survivor) {
          const vp = useDesignerStore.getState().viewport;
          panRef.current = {
            pointerId: survivorId,
            startX: survivor.x,
            startY: survivor.y,
            origX: vp.x,
            origY: vp.y,
          };
          panMovedRef.current = true;
          setPanning(true);
        }
      }

      if (panRef.current?.pointerId === e.pointerId) panRef.current = null;
      if (dragRef.current?.pointerId === e.pointerId) applyDrag(null);

      // Sweep. Whether the view is being steered is asked of the refs, not of
      // which pointer just ended — a finger the OS reclaimed, or one whose lift
      // never reached us, would otherwise leave the board inert for good, every
      // box deaf to the pointer with nothing left to explain why.
      if (!panRef.current) setPanning(false);
      if (!pinchRef.current) setPinching(false);
    },
    [cancelLongPress, releaseCapture, applyDrag]
  );

  // Wheel: pan by default, zoom under Ctrl/⌘ (which is also how a browser
  // delivers a trackpad pinch). Registered natively with `passive: false` —
  // React's own wheel listener is passive, so `preventDefault` there cannot stop
  // the page from zooming out from under the canvas.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = useDesignerStore.getState().viewport;
      const dx = wheelPixels(e.deltaX, e.deltaMode);
      const dy = wheelPixels(e.deltaY, e.deltaMode);

      if (e.ctrlKey || e.metaKey) {
        const anchor = toCanvasPoint(e.clientX, e.clientY);
        const next = zoomAt(vp, Math.exp(-dy * 0.0025), anchor);
        if (next !== vp) setViewport(next);
        return;
      }
      // Shift turns the wheel sideways; a trackpad already reports deltaX.
      const moveX = e.shiftKey ? -(dx || dy) : -dx;
      const moveY = e.shiftKey ? 0 : -dy;
      if (moveX === 0 && moveY === 0) return;
      setViewport(panBy(vp, moveX, moveY));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [setViewport, toCanvasPoint]);

  // Space arms the pan grip. Held down it must not scroll the page, and it must
  // stay inert while the user is typing into a panel.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    // Losing the window mid-hold would otherwise leave the grip stuck on.
    const release = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);

  /** Zoom from the buttons: anchored at the middle of the canvas. */
  const zoomFromCentre = useCallback(
    (factor: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const anchor = { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
      const vp = useDesignerStore.getState().viewport;
      const next = zoomAt(vp, factor, anchor);
      if (next !== vp) setViewport(next);
    },
    [setViewport]
  );

  const resetZoom = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    const anchor = { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    setViewport(zoomTo(useDesignerStore.getState().viewport, 1, anchor));
  }, [setViewport]);

  /** Frame every box of the current drill level — the answer to "where did it go". */
  const fitToView = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const boxes = currentChildren.map((s) => getPos(s.name));
    setViewport(
      boxes.length ? fitToBoxes(boxes, rect.width, rect.height) : { ...IDENTITY_VIEWPORT }
    );
  }, [currentChildren, getPos, setViewport]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, stateName?: string) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, stateName ? { kind: "state", id: stateName } : { kind: "canvas" });
    },
    [showContextMenu]
  );

  const handleEventPick = (eventId: string) => {
    if (!eventPicker) return;
    addTransition(eventPicker.stateName, { event: eventId, nextState: eventPicker.targetName });
    setEventPicker(null);
    setDrawSource(null);
    setDrawMode("select");
  };

  // Collect transitions for arrows (within current navigation level). Memoized
  // so its identity is stable across renders (drag/selection) — the WS7b commit
  // effect lists it as a dependency.
  const arrows = useMemo(() => {
    const childNames = new Set(currentChildren.map((s) => s.name));
    const result: { from: string; to: string; event: string; stateName: string; index: number; condition?: string }[] = [];
    for (const state of currentChildren) {
      for (const [i, t] of (state.transitions ?? []).entries()) {
        if (t.nextState && childNames.has(t.nextState)) {
          result.push({ from: state.name, to: t.nextState, event: t.event, stateName: state.name, index: i, condition: t.condition });
        }
      }
    }
    return result;
  }, [currentChildren]);

  // WS7b — after each commit, diff the freshly-rendered nodes/edges against the
  // previous render (held in refs, touched only here). Newly-present names/edges
  // are flagged as "entering" (drives sm-node-enter / sm-edge-enter on the NEXT
  // render's fresh element); names that vanished from the current drill level are
  // captured with their last def + position into `exitingNodes` so they animate
  // out. Drill-level changes are NOT add/remove: the new level just blooms in and
  // stale exit nodes are cleared.
  useEffect(() => {
    const currentNames = new Set(currentChildren.map((s) => s.name));
    const currentEdgeKeys = new Set(arrows.map((a) => `${a.stateName}:${a.index}`));
    const sameLevel = prevParentRef.current === currentParent;

    const newNames = [...currentNames].filter((n) => !prevNamesRef.current.has(n));
    if (newNames.length) {
      setEnteringNames((prev) => {
        const next = new Set(prev);
        newNames.forEach((n) => next.add(n));
        return next;
      });
    }

    const newEdges = [...currentEdgeKeys].filter((k) => !prevEdgeKeysRef.current.has(k));
    if (newEdges.length) {
      setEnteringEdges((prev) => {
        const next = new Set(prev);
        newEdges.forEach((k) => next.add(k));
        return next;
      });
    }

    // Prune enter markers for nodes/edges that no longer exist (keeps the sets
    // bounded to what is currently on-canvas).
    setEnteringNames((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((n) => {
        if (!currentNames.has(n)) { next.delete(n); changed = true; }
      });
      return changed ? next : prev;
    });
    setEnteringEdges((prev) => {
      let changed = false;
      const next = new Set(prev);
      prev.forEach((k) => {
        if (!currentEdgeKeys.has(k)) { next.delete(k); changed = true; }
      });
      return changed ? next : prev;
    });

    if (sameLevel) {
      setExitingNodes((prev) => {
        const next = new Map(prev);
        let changed = false;
        prevNodeDataRef.current.forEach((data, name) => {
          if (!currentNames.has(name) && !next.has(name)) {
            next.set(name, data);
            changed = true;
          }
        });
        // A node that reappeared must never linger in the exiting layer.
        currentNames.forEach((name) => {
          if (next.delete(name)) changed = true;
        });
        return changed ? next : prev;
      });
    } else {
      setExitingNodes((prev) => (prev.size ? new Map() : prev));
    }

    prevNamesRef.current = currentNames;
    prevNodeDataRef.current = new Map(
      currentChildren.map((s) => [s.name, { state: s, pos: getPos(s.name) }])
    );
    prevEdgeKeysRef.current = currentEdgeKeys;
    prevParentRef.current = currentParent;
  }, [currentChildren, currentParent, arrows, getPos]);

  return (
    // The canvas *pane*, not just the SVG. Two things hang off this element.
    //
    // `data-pinch-owner` is what the chrome pinch reads to disqualify itself
    // (see lib/gestureOwner.ts): a finger anywhere in here — the board, the
    // breadcrumb, the zoom HUD — means this gesture is about the machine, never
    // about the size of the menus.
    //
    // `touch-action: none` extends the SVG's own refusal to the overlays sitting
    // on top of it. The SVG had it; the HUD and the breadcrumb did not, so a
    // pinch that happened to open with a finger on the zoom bar was still a
    // browser page zoom. Nothing in this pane scrolls, so denying everything
    // costs nothing.
    <div
      className="relative w-full h-full"
      style={{ touchAction: "none" }}
      data-pinch-owner={CANVAS_PINCH_OWNER}
    >
      {/* Breadcrumb navigation */}
      {navigationPath.length > 1 && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-1.5 text-sm">
          {navigationPath.map((name, i) => (
            <span key={name} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-600">›</span>}
              <button
                className={`hover:text-blue-400 ${i === navigationPath.length - 1 ? "text-blue-400 font-semibold" : "text-gray-400"}`}
                onClick={() => navigateUp(i)}
              >
                {name}
              </button>
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        className="w-full h-full bg-gray-950"
        style={{
          cursor: panning ? "grabbing" : spaceHeld ? "grab" : undefined,
          // The browser's own gestures are all suppressed here, so every one of
          // them has to be answered below: one finger pans, two pinch, and a
          // held finger opens the menu.
          touchAction: "none",
          // On a touch device a resting finger would otherwise raise the system
          // selection callout on top of our own held-press menu.
          ...(coarsePointer
            ? {
                WebkitUserSelect: "none" as const,
                userSelect: "none" as const,
                WebkitTouchCallout: "none" as const,
              }
            : {}),
        }}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handleSurfacePointerUp}
        onPointerCancel={handleSurfacePointerUp}
        // Middle-click on Linux/Windows would otherwise paste or autoscroll.
        onAuxClick={(e) => e.preventDefault()}
        onClick={(e) => {
          // A hold that opened the menu still ends in a click on most touch
          // browsers. It must not reach the shell, which closes the menu on any
          // click that arrives — the menu would flash and vanish on the lift.
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.stopPropagation();
            return;
          }
          // A pan that travelled is not a click on empty space.
          if (panMovedRef.current) {
            panMovedRef.current = false;
            return;
          }
          if ((e.target as SVGElement)?.tagName === 'svg') {
            clearSelection();
            setEventPicker(null);
          }
        }}
        onContextMenu={(e) => handleContextMenu(e)}
      >
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
          <marker id="arrowhead-blue" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
          </marker>
        </defs>

        {/* Draw mode indicator line */}
        {drawMode === "transition" && drawSource && (
          <text x="50%" y="30" fill="#f59e0b" fontSize={13} textAnchor="middle" className="pointer-events-none select-none">
            Click target state to create transition from &quot;{drawSource}&quot;
          </text>
        )}

        {/* The navigated world. One transform on one group: every arrow, box and
            label below inherits the pan and the zoom without knowing they exist.
            While the view is being steered — panned or pinched — the content
            stops answering the pointer, so the grabbing cursor is not fought
            over by the boxes underneath, and a finger that drifts onto a box
            mid-pinch does not start dragging it. */}
        <g
          transform={viewportTransform(viewport)}
          style={navigating ? { pointerEvents: "none" } : undefined}
        >

        {/* Transition arrows */}
        {arrows.map((arrow, i) => {
          const from = getPos(arrow.from);
          const to = getPos(arrow.to);
          const fx = from.x + from.width / 2;
          const fy = from.y + from.height;
          const tx = to.x + to.width / 2;
          const ty = to.y;
          const midY = (fy + ty) / 2;
          const isSelected = selection.kind === "transition" && selection.id === `${arrow.stateName}:${arrow.index}`;

          // WS7b — a new edge (flagged in the commit effect) draws itself on.
          const edgeEntering = enteringEdges.has(`${arrow.stateName}:${arrow.index}`);
          const edgeId = `${arrow.stateName}:${arrow.index}`;
          const curve = `M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
          const labelH = arrow.condition ? 28 : 18;

          return (
            <g key={`arrow-${i}`}>
              {/* A 1.5px thread is a fair target for a cursor and none at all for
                  a fingertip. This traces the same curve with a wide invisible
                  stroke underneath it — same selection, same path, just a band
                  a finger can actually land on. `pointerEvents="stroke"` hits
                  the perimeter geometry regardless of what the paint does. */}
              {coarsePointer && (
                <path
                  d={curve}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={touchEdgeStroke}
                  strokeLinecap="round"
                  pointerEvents="stroke"
                  onClick={(e) => {
                    e.stopPropagation();
                    select("transition", edgeId);
                  }}
                />
              )}
              <path
                d={curve}
                fill="none"
                pathLength={1}
                stroke={isSelected ? "#3b82f6" : "#94a3b8"}
                strokeWidth={isSelected ? 2.5 : 1.5}
                markerEnd={isSelected ? "url(#arrowhead-blue)" : "url(#arrowhead)"}
                className={`cursor-pointer hover:stroke-blue-400${edgeEntering ? " sm-edge-enter" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  select("transition", `${arrow.stateName}:${arrow.index}`);
                }}
              />
              {/* Event label on edge */}
              <g
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  select("transition", `${arrow.stateName}:${arrow.index}`);
                }}
              >
                {/* The same cuff the boxes get, so the event chip is reachable
                    without the label itself being redrawn any larger. */}
                {coarsePointer && (
                  <rect
                    x={(fx + tx) / 2 - 40 - touchPad}
                    y={midY - 18 - touchPad}
                    width={80 + touchPad * 2}
                    height={labelH + touchPad * 2}
                    fill="transparent"
                    pointerEvents="all"
                  />
                )}
                <rect
                  x={(fx + tx) / 2 - 40}
                  y={midY - 18}
                  width={80}
                  height={labelH}
                  rx={4}
                  fill={isSelected ? "#1e3a5f" : "#1e293b"}
                  stroke={isSelected ? "#3b82f6" : "#334155"}
                  strokeWidth={1}
                  className="hover:fill-gray-800"
                />
                <text
                  x={(fx + tx) / 2}
                  y={midY - 5}
                  fill={isSelected ? "#93c5fd" : "#94a3b8"}
                  fontSize={11}
                  fontWeight={500}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                >
                  {arrow.event}
                </text>
                {arrow.condition && (
                  <text
                    x={(fx + tx) / 2}
                    y={midY + 7}
                    fill="#64748b"
                    fontSize={9}
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                  >
                    [{arrow.condition}]
                  </text>
                )}
              </g>
            </g>
          );
        })}

        {/* State nodes */}
        {currentChildren.map((state) => {
          const pos = getPos(state.name);
          const isSelected = selection.kind === "state" && selection.id === state.name;
          const isFinal = state.kind === "final";
          const isHistory = state.kind === "history";
          const isComposite = (state.states?.length ?? 0) > 0;
          const isDrawSource = drawSource === state.name;
          const errored = hasError(state.name);
          const hasEntry = (state.onEntry?.actions?.length ?? 0) > 0;
          const hasExit = (state.onExit?.actions?.length ?? 0) > 0;
          const isActive = activeStates.includes(state.name);
          // WS7b — a node first seen this session (flagged in the commit effect)
          // carries sm-node-enter; the bloom only fires on the freshly-mounted
          // element, so the marker staying set for existing nodes is inert.
          const entering = enteringNames.has(state.name);

          return (
            <g
              key={state.name}
              onPointerDown={(e) => handleNodePointerDown(e, state.name)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (isComposite) navigateInto(state.name);
              }}
              onContextMenu={(e) => handleContextMenu(e, state.name)}
              className={
                spaceHeld
                  ? undefined // the surface owns the cursor while the pan grip is armed
                  : drawMode === "transition"
                  ? "cursor-crosshair"
                  : isComposite
                  ? "cursor-pointer"
                  : "cursor-grab active:cursor-grabbing"
              }
            >
              {/* An invisible cuff, drawn first so it sits behind everything and
                  changes nothing you can see. It widens the box's answer to a
                  fingertip without widening the box. Outside the entering group
                  on purpose: the bloom animation is a visual, and the target
                  must be live from the first frame. */}
              {coarsePointer && (
                <rect
                  x={pos.x - touchPad}
                  y={pos.y - touchPad}
                  width={pos.width + touchPad * 2}
                  height={pos.height + touchPad * 2}
                  rx={12}
                  fill="transparent"
                  pointerEvents="all"
                />
              )}
              <g className={entering ? "sm-node-enter" : undefined}>
              <rect
                x={pos.x}
                y={pos.y}
                width={pos.width}
                height={pos.height}
                rx={isHistory ? 30 : isFinal ? 4 : 8}
                fill={isDrawSource ? "#1e3a5f" : isFinal ? "#1e293b" : isComposite ? "#0c1020" : "#0f172a"}
                stroke={errored ? "#ef4444" : isSelected ? "#3b82f6" : isDrawSource ? "#f59e0b" : "#475569"}
                strokeWidth={isSelected ? 2.5 : errored ? 2 : 1.5}
                strokeDasharray={isFinal ? "6 3" : isComposite ? "4 2" : undefined}
                className={isActive ? "sm-node-active" : undefined}
              />
              {/* State name */}
              <text
                x={pos.x + pos.width / 2}
                y={pos.y + (hasEntry || hasExit ? pos.height / 2 : pos.height / 2 + 5)}
                fill="#e2e8f0"
                fontSize={14}
                fontWeight={600}
                textAnchor="middle"
                className="pointer-events-none select-none"
              >
                {state.name}
              </text>
              {/* Kind badge */}
              {state.kind && state.kind !== "normal" && (
                <text
                  x={pos.x + pos.width - 8}
                  y={pos.y + 14}
                  fill="#64748b"
                  fontSize={10}
                  textAnchor="end"
                  className="pointer-events-none select-none"
                >
                  {state.kind}
                </text>
              )}
              {/* Entry/exit indicators */}
              {hasEntry && (
                <text x={pos.x + 6} y={pos.y + pos.height - 6} fill="#22c55e" fontSize={9} className="pointer-events-none select-none">
                  ▸entry
                </text>
              )}
              {hasExit && (
                <text x={pos.x + pos.width - 6} y={pos.y + pos.height - 6} fill="#f97316" fontSize={9} textAnchor="end" className="pointer-events-none select-none">
                  exit◂
                </text>
              )}
              {/* Error indicator */}
              {errored && (
                <text x={pos.x + 6} y={pos.y + 14} fill="#ef4444" fontSize={12} className="pointer-events-none select-none">
                  ⚠
                </text>
              )}
              {/* Composite indicator (drill-down hint) */}
              {isComposite && (
                <text x={pos.x + pos.width / 2} y={pos.y + pos.height - 6} fill="#6366f1" fontSize={9} textAnchor="middle" className="pointer-events-none select-none">
                  ▼ {state.states?.length} children — double-click to enter
                </text>
              )}
              </g>
            </g>
          );
        })}

        {/* Exiting nodes — outlive React's unmount to animate out (WS7b). Rendered
            from captured def + last position; non-interactive; removed on end. */}
        {Array.from(exitingNodes.entries()).map(([name, { state, pos }]) => {
          const exFinal = state.kind === "final";
          const exComposite = (state.states?.length ?? 0) > 0;
          return (
            <g
              key={`exit-${name}`}
              className="sm-node-exit"
              style={{ pointerEvents: "none" }}
              onAnimationEnd={(e) => {
                if (e.animationName !== "sm-node-out") return;
                setExitingNodes((prev) => {
                  if (!prev.has(name)) return prev;
                  const next = new Map(prev);
                  next.delete(name);
                  return next;
                });
              }}
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={pos.width}
                height={pos.height}
                rx={state.kind === "history" ? 30 : exFinal ? 4 : 8}
                fill={exFinal ? "#1e293b" : exComposite ? "#0c1020" : "#0f172a"}
                stroke="#475569"
                strokeWidth={1.5}
                strokeDasharray={exFinal ? "6 3" : exComposite ? "4 2" : undefined}
              />
              <text
                x={pos.x + pos.width / 2}
                y={pos.y + pos.height / 2 + 5}
                fill="#e2e8f0"
                fontSize={14}
                fontWeight={600}
                textAnchor="middle"
                className="select-none"
              >
                {name}
              </text>
            </g>
          );
        })}
        </g>
        {/* — end of the navigated world; everything below is screen space — */}

        {/* Empty state message */}
        {currentChildren.length === 0 && (
          <text x="50%" y="50%" fill="#475569" fontSize={16} textAnchor="middle">
            {coarsePointer
              ? "Press and hold to add a state, or load a .smdf.json file"
              : "Right-click to add a state, or load a .smdf.json file"}
          </text>
        )}
      </svg>

      {/* Navigation HUD — screen space, never transformed. The buttons grow for
          a fingertip and only then; a cursor keeps the compact bar. */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 bg-gray-900/90 border border-gray-700 rounded-lg px-1.5 py-1 text-xs text-gray-400 select-none">
        <button
          className={`${hudButton} rounded hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent`}
          title="Zoom out (Ctrl + wheel down, or pinch in)"
          disabled={viewport.scale <= VIEWPORT_LIMITS.min}
          onClick={() => zoomFromCentre(1 / 1.25)}
        >
          −
        </button>
        <button
          className={`${hudButton} rounded hover:bg-gray-800 hover:text-gray-200 tabular-nums min-w-[3.25rem]`}
          title="Reset zoom to 100%"
          onClick={resetZoom}
        >
          {Math.round(viewport.scale * 100)}%
        </button>
        <button
          className={`${hudButton} rounded hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent`}
          title="Zoom in (Ctrl + wheel up, or pinch out)"
          disabled={viewport.scale >= VIEWPORT_LIMITS.max}
          onClick={() => zoomFromCentre(1.25)}
        >
          ＋
        </button>
        <span className="text-gray-700 px-0.5">|</span>
        <button
          className={`${hudButton} rounded hover:bg-gray-800 hover:text-gray-200`}
          title="Fit the whole machine in view"
          onClick={fitToView}
        >
          ⤢ Fit
        </button>
        <span className="text-gray-700 px-0.5">|</span>
        <span
          className="px-1 text-[10px] text-gray-600"
          title={
            coarsePointer
              ? "Drag to pan · pinch with two fingers to zoom · press and hold for the menu · double-tap a composite to enter it"
              : "Wheel scrolls · Shift+wheel scrolls sideways · Ctrl+wheel zooms at the cursor · middle-drag or Space+drag pans"
          }
        >
          {pinching
            ? "pinching"
            : panning
            ? "panning"
            : coarsePointer
            ? "drag · pinch · hold"
            : spaceHeld
            ? "space to pan"
            : "wheel · ⌃wheel · space"}
        </span>
      </div>

      {/* Event picker popup */}
      {eventPicker && (
        <div
          className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[160px]"
          style={{ left: eventPicker.x, top: eventPicker.y - 80 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs text-gray-400 mb-1 px-1">
            {eventPicker.stateName} → {eventPicker.targetName}
          </div>
          <div className="text-xs text-gray-500 mb-1 px-1">Select event:</div>
          {allEvents.length === 0 ? (
            <div className="text-xs text-gray-600 px-1 py-2">No events defined. Add events first.</div>
          ) : (
            allEvents.map((evt) => (
              <button
                key={evt.id}
                className="block w-full text-left text-sm text-gray-300 hover:bg-gray-800 px-2 py-1 rounded"
                onClick={() => handleEventPick(evt.id)}
              >
                {evt.id}
              </button>
            ))
          )}
          <button
            className="block w-full text-left text-xs text-gray-500 hover:text-gray-300 px-2 py-1 mt-1 border-t border-gray-800"
            onClick={() => { setEventPicker(null); setDrawSource(null); }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
