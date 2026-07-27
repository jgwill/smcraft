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
import { useDesignerStore } from "@/store/useDesignerStore";
import { useLayoutMemory } from "@/lib/layoutMemory";
import type { StatePosition, StateDef } from "@/types/definition";

interface DragState {
  name: string;
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

/** Wheel notches arrive in three units; normalise them to pixels. */
const WHEEL_LINE_HEIGHT = 16;
const WHEEL_PAGE_HEIGHT = 400;

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
  // Whoever holds the pointer for the gesture in flight, so it can be released.
  const captureRef = useRef<Element | null>(null);

  // Remembered board: restore this browser's drags, then keep writing them back.
  useLayoutMemory();

  /** Pointer position relative to the canvas element — the space zoom anchors in. */
  const toCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

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

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, name: string) => {
      // Middle button, or space held: this gesture belongs to the surface. Let
      // it bubble un-stopped so the pan handler below picks it up.
      if (e.button !== 0 || spaceRef.current) return;
      e.stopPropagation();
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
      setDrag({ name, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y });
      // Capture on the node's own group, so the gesture survives the pointer
      // outrunning the box or leaving the canvas. It must be *this* element and
      // not the surface: a capture retargets the click and dblclick that follow,
      // and retargeting them to the <svg> would read as a click on empty space —
      // clearing the selection the press just made, and stealing the
      // double-click that drills into a composite.
      const node = e.currentTarget as Element;
      captureRef.current = node;
      node.setPointerCapture?.(e.pointerId);
    },
    [select, getPos, drawMode, drawSource, setDrawSource]
  );

  const handleSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const wantsPan = e.button === 1 || (e.button === 0 && spaceRef.current);
      if (!wantsPan) return;
      // Suppresses the compatibility mouse events, and with them Chrome's
      // middle-click autoscroll.
      e.preventDefault();
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
      captureRef.current = svgRef.current;
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    []
  );

  const handleSurfacePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pan = panRef.current;
      if (pan) {
        const dx = e.clientX - pan.startX;
        const dy = e.clientY - pan.startY;
        if (dx !== 0 || dy !== 0) panMovedRef.current = true;
        const scale = useDesignerStore.getState().viewport.scale;
        setViewport({ x: pan.origX + dx, y: pan.origY + dy, scale });
        return;
      }
      if (!drag) return;
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
    [drag, getPos, setStatePosition, setViewport]
  );

  const handleSurfacePointerUp = useCallback((e: React.PointerEvent) => {
    const held = captureRef.current as (Element & {
      hasPointerCapture?: (id: number) => boolean;
      releasePointerCapture?: (id: number) => void;
    }) | null;
    if (held?.hasPointerCapture?.(e.pointerId)) held.releasePointerCapture?.(e.pointerId);
    captureRef.current = null;
    if (panRef.current?.pointerId === e.pointerId) {
      panRef.current = null;
      setPanning(false);
    }
    setDrag(null);
  }, []);

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
    <div className="relative w-full h-full">
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
          touchAction: "none",
        }}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handleSurfacePointerUp}
        onPointerCancel={handleSurfacePointerUp}
        // Middle-click on Linux/Windows would otherwise paste or autoscroll.
        onAuxClick={(e) => e.preventDefault()}
        onClick={(e) => {
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
            While a pan is in flight the content stops answering the pointer, so
            the grabbing cursor is not fought over by the boxes underneath. */}
        <g
          transform={viewportTransform(viewport)}
          style={panning ? { pointerEvents: "none" } : undefined}
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

          return (
            <g key={`arrow-${i}`}>
              <path
                d={`M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`}
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
                <rect
                  x={(fx + tx) / 2 - 40}
                  y={midY - 18}
                  width={80}
                  height={arrow.condition ? 28 : 18}
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
            Right-click to add a state, or load a .smdf.json file
          </text>
        )}
      </svg>

      {/* Navigation HUD — screen space, never transformed. */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 bg-gray-900/90 border border-gray-700 rounded-lg px-1.5 py-1 text-xs text-gray-400 select-none">
        <button
          className="px-1.5 py-0.5 rounded hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Zoom out (Ctrl + wheel down)"
          disabled={viewport.scale <= VIEWPORT_LIMITS.min}
          onClick={() => zoomFromCentre(1 / 1.25)}
        >
          −
        </button>
        <button
          className="px-1.5 py-0.5 rounded hover:bg-gray-800 hover:text-gray-200 tabular-nums min-w-[3.25rem]"
          title="Reset zoom to 100%"
          onClick={resetZoom}
        >
          {Math.round(viewport.scale * 100)}%
        </button>
        <button
          className="px-1.5 py-0.5 rounded hover:bg-gray-800 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Zoom in (Ctrl + wheel up)"
          disabled={viewport.scale >= VIEWPORT_LIMITS.max}
          onClick={() => zoomFromCentre(1.25)}
        >
          ＋
        </button>
        <span className="text-gray-700 px-0.5">|</span>
        <button
          className="px-1.5 py-0.5 rounded hover:bg-gray-800 hover:text-gray-200"
          title="Fit the whole machine in view"
          onClick={fitToView}
        >
          ⤢ Fit
        </button>
        <span className="text-gray-700 px-0.5">|</span>
        <span
          className="px-1 text-[10px] text-gray-600"
          title="Wheel scrolls · Shift+wheel scrolls sideways · Ctrl+wheel zooms at the cursor · middle-drag or Space+drag pans"
        >
          {panning ? "panning" : spaceHeld ? "space to pan" : "wheel · ⌃wheel · space"}
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
