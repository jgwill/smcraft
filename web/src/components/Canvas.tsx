"use client";

import { useRef, useCallback, useState, useEffect, useLayoutEffect } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { StatePosition } from "@/types/definition";

interface DragState {
  name: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

interface PanDragState {
  startX: number;
  startY: number;
  origPanX: number;
  origPanY: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

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
  const navigateInto = useDesignerStore((s) => s.navigateInto);
  const navigateUp = useDesignerStore((s) => s.navigateUp);
  const getCurrentChildren = useDesignerStore((s) => s.getCurrentChildren);
  const viewport = useDesignerStore((s) => s.viewport);
  const zoomRequest = useDesignerStore((s) => s.zoomRequest);
  const fitRequestToken = useDesignerStore((s) => s.fitRequestToken);
  const resetRequestToken = useDesignerStore((s) => s.resetRequestToken);
  const setViewport = useDesignerStore((s) => s.setViewport);

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [eventPicker, setEventPicker] = useState<{ stateName: string; targetName: string; x: number; y: number } | null>(null);

  // Stable ref so the wheel-zoom effect (set up once) always reads the latest viewport
  const viewportRef = useRef(viewport);
  useLayoutEffect(() => { viewportRef.current = viewport; });

  // Show only children of current navigation level (not flattened)
  const currentChildren = getCurrentChildren();
  const allEvents = definition.events.flatMap((src) => src.events ?? []);

  // Refs for fit-to-frame so the effect reads the latest values without being re-registered
  const currentChildrenRef = useRef(currentChildren);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    currentChildrenRef.current = currentChildren;
    layoutRef.current = layout;
  });

  const clearPointerInteraction = useCallback(() => {
    setDrag(null);
    setPanDrag(null);
  }, []);

  const getContentBounds = useCallback(() => {
    const children = currentChildrenRef.current;
    if (children.length === 0) {
      return null;
    }

    const positions = layoutRef.current.positions;
    const defaultPos = (): StatePosition => ({ x: 100, y: 100, width: 160, height: 60 });

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const state of children) {
      const pos = positions[state.name] ?? defaultPos();
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    }

    if (maxX - minX < 1 || maxY - minY < 1) {
      return null;
    }

    return { minX, minY, maxX, maxY };
  }, []);

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

  useEffect(() => {
    window.addEventListener("mouseup", clearPointerInteraction);
    return () => window.removeEventListener("mouseup", clearPointerInteraction);
  }, [clearPointerInteraction]);

  // Wheel-zoom: non-passive so we can preventDefault; anchored to cursor position
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const { scale, panX, panY } = viewportRef.current;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.min(Math.max(scale * factor, MIN_SCALE), MAX_SCALE);

      // Keep the canvas point under the cursor fixed after zoom
      const pointX = (cursorX - panX) / scale;
      const pointY = (cursorY - panY) / scale;

      setViewport(newScale, cursorX - pointX * newScale, cursorY - pointY * newScale);
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [setViewport]); // setViewport is a stable Zustand reference

  useEffect(() => {
    if (!zoomRequest) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const anchorX = rect.width / 2;
    const anchorY = rect.height / 2;
    if (anchorX <= 0 || anchorY <= 0) return;
    const { scale, panX, panY } = viewportRef.current;
    const newScale = Math.min(Math.max(scale * zoomRequest.factor, MIN_SCALE), MAX_SCALE);

    const pointX = (anchorX - panX) / scale;
    const pointY = (anchorY - panY) / scale;

    setViewport(newScale, anchorX - pointX * newScale, anchorY - pointY * newScale);
  }, [zoomRequest, setViewport]);

  // Fit-to-frame: triggered by fitRequestToken increment from Toolbar
  useEffect(() => {
    if (fitRequestToken === 0) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const svgW = rect.width;
    const svgH = rect.height;
    if (svgW <= 0 || svgH <= 0) return;
    const bounds = getContentBounds();
    if (!bounds) return;
    const { minX, minY, maxX, maxY } = bounds;

    const PADDING = 48;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availableW = Math.max(svgW - PADDING * 2, 1);
    const availableH = Math.max(svgH - PADDING * 2, 1);
    const newScale = Math.min(
      Math.max(
        Math.min(
          availableW / contentW,
          availableH / contentH,
          2, // don't over-zoom on tiny diagrams
        ),
        MIN_SCALE,
      ),
      MAX_SCALE,
    );
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    setViewport(newScale, svgW / 2 - midX * newScale, svgH / 2 - midY * newScale);
  }, [fitRequestToken, getContentBounds, setViewport]);

  useEffect(() => {
    if (resetRequestToken === 0) return;
    const svg = svgRef.current;
    if (!svg) return;

    const bounds = getContentBounds();
    if (!bounds) {
      setViewport(1, 0, 0);
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const { minX, minY, maxX, maxY } = bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    setViewport(1, rect.width / 2 - midX, rect.height / 2 - midY);
  }, [getContentBounds, resetRequestToken, setViewport]);

  const getPos = useCallback(
    (name: string): StatePosition =>
      layout.positions[name] ?? { x: 100, y: 100, width: 160, height: 60 },
    [layout]
  );

  const hasError = useCallback(
    (name: string) => errors.some((e) => e.element === name),
    [errors]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, name: string) => {
      if (e.button === 2) return;
      e.stopPropagation();
      if (e.button === 1) {
        e.preventDefault();
        setPanDrag({
          startX: e.clientX,
          startY: e.clientY,
          origPanX: viewportRef.current.panX,
          origPanY: viewportRef.current.panY,
        });
        return;
      }
      if (drawMode === "transition") {
        if (!drawSource) {
          setDrawSource(name);
        } else if (drawSource !== name) {
          const rect = svgRef.current?.getBoundingClientRect();
          // Show event picker
          setEventPicker({
            stateName: drawSource,
            targetName: name,
            x: e.clientX - (rect?.left ?? 0),
            y: e.clientY - (rect?.top ?? 0),
          });
        }
        return;
      }
      select("state", name);
      const pos = getPos(name);
      setDrag({ name, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y });
    },
    [select, getPos, drawMode, drawSource, setDrawSource]
  );

  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 2) return;
      const isMiddleButton = e.button === 1;
      const isPrimaryBackground = e.button === 0 && e.target === e.currentTarget && drawMode === "select";
      if (!isMiddleButton && !isPrimaryBackground) return;
      if (e.button === 1) {
        e.preventDefault();
      }
      setPanDrag({
        startX: e.clientX,
        startY: e.clientY,
        origPanX: viewportRef.current.panX,
        origPanY: viewportRef.current.panY,
      });
    },
    [drawMode]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (drag) {
        // Divide screen-pixel delta by scale to get canvas-space delta
        const { scale } = viewportRef.current;
        const dx = (e.clientX - drag.startX) / scale;
        const dy = (e.clientY - drag.startY) / scale;
        const pos = getPos(drag.name);
        setStatePosition(drag.name, {
          ...pos,
          x: Math.max(0, drag.origX + dx),
          y: Math.max(0, drag.origY + dy),
        });
        return;
      }
      if (panDrag) {
        const newPanX = panDrag.origPanX + (e.clientX - panDrag.startX);
        const newPanY = panDrag.origPanY + (e.clientY - panDrag.startY);
        setViewport(viewportRef.current.scale, newPanX, newPanY);
      }
    },
    [drag, panDrag, getPos, setStatePosition, setViewport]
  );

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

  // Collect transitions for arrows (within current navigation level)
  const currentChildNames = new Set(currentChildren.map(s => s.name));
  const arrows: { from: string; to: string; event: string; stateName: string; index: number; condition?: string }[] = [];
  for (const state of currentChildren) {
    for (const [i, t] of (state.transitions ?? []).entries()) {
      if (t.nextState && currentChildNames.has(t.nextState)) {
        arrows.push({ from: state.name, to: t.nextState, event: t.event, stateName: state.name, index: i, condition: t.condition });
      }
    }
  }

  const { scale, panX, panY } = viewport;
  const isPanning = panDrag !== null;

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
        style={{ cursor: isPanning ? "grabbing" : drawMode === "transition" ? "crosshair" : "default" }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={clearPointerInteraction}
        onClick={(e) => {
          if ((e.target as SVGElement)?.tagName === "svg") {
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

        {/* Draw mode indicator — fixed to viewport, outside the canvas transform */}
        {drawMode === "transition" && drawSource && (
          <text x="50%" y="30" fill="#f59e0b" fontSize={13} textAnchor="middle" className="pointer-events-none select-none">
            Click target state to create transition from &quot;{drawSource}&quot;
          </text>
        )}

        {/* ── Canvas transform group ── all diagram content lives here ── */}
        <g transform={`translate(${panX} ${panY}) scale(${scale})`}>
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

            return (
              <g key={`arrow-${i}`}>
                <path
                  d={`M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`}
                  fill="none"
                  stroke={isSelected ? "#3b82f6" : "#94a3b8"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  markerEnd={isSelected ? "url(#arrowhead-blue)" : "url(#arrowhead)"}
                  className="cursor-pointer hover:stroke-blue-400"
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

            return (
              <g
                key={state.name}
                onMouseDown={(e) => handleMouseDown(e, state.name)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (isComposite) navigateInto(state.name);
                }}
                onContextMenu={(e) => handleContextMenu(e, state.name)}
                className={drawMode === "transition" ? "cursor-crosshair" : isComposite ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}
              >
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
            );
          })}
        </g>
        {/* ── End canvas transform group ── */}

        {/* Empty state message — fixed to viewport */}
        {currentChildren.length === 0 && (
          <text x="50%" y="50%" fill="#475569" fontSize={16} textAnchor="middle">
            Right-click to add a state, or load a .smdf.json file
          </text>
        )}
      </svg>

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
