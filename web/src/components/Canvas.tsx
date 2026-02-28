"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { useDesignerStore, collectAllStates } from "@/store/useDesignerStore";
import type { StatePosition, StateDef } from "@/types/definition";

interface DragState {
  name: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
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
  const addState = useDesignerStore((s) => s.addState);
  const removeState = useDesignerStore((s) => s.removeState);
  const updateState = useDesignerStore((s) => s.updateState);
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const errors = useDesignerStore((s) => s.errors);

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [eventPicker, setEventPicker] = useState<{ stateName: string; targetName: string; x: number; y: number } | null>(null);

  const allStates = collectAllStates(definition.state);
  const leafStates = allStates.filter((s) => s.name !== "Root");
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, name: string) => {
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
    },
    [select, getPos, drawMode, drawSource, setDrawSource]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const pos = getPos(drag.name);
      setStatePosition(drag.name, {
        ...pos,
        x: Math.max(0, drag.origX + dx),
        y: Math.max(0, drag.origY + dy),
      });
    },
    [drag, getPos, setStatePosition]
  );

  const handleMouseUp = useCallback(() => setDrag(null), []);

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

  // Collect all transitions for arrows
  const arrows: { from: string; to: string; event: string; stateName: string; index: number; condition?: string }[] = [];
  for (const state of leafStates) {
    for (const [i, t] of (state.transitions ?? []).entries()) {
      if (t.nextState) {
        arrows.push({ from: state.name, to: t.nextState, event: t.event, stateName: state.name, index: i, condition: t.condition });
      }
    }
  }

  return (
    <div className="relative w-full h-full">
      <svg
        ref={svgRef}
        className="w-full h-full bg-gray-950"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={() => { clearSelection(); setEventPicker(null); }}
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
        {leafStates.map((state) => {
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
              onContextMenu={(e) => handleContextMenu(e, state.name)}
              className={drawMode === "transition" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}
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
            </g>
          );
        })}

        {/* Empty state message */}
        {leafStates.length === 0 && (
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
