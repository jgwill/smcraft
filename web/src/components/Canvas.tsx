"use client";

import { useRef, useCallback, useState } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { StatePosition } from "@/types/definition";

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

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const states = definition.state.states ?? [];
  const eventIds = definition.events.flatMap(
    (src) => (src.events ?? []).map((e) => e.id)
  );

  const getPos = useCallback(
    (name: string): StatePosition =>
      layout.positions[name] ?? { x: 100, y: 100, width: 160, height: 60 },
    [layout]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, name: string) => {
      e.stopPropagation();
      select("state", name);
      const pos = getPos(name);
      setDrag({ name, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y });
    },
    [select, getPos]
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

  const handleMouseUp = useCallback(() => {
    setDrag(null);
  }, []);

  // Collect transitions for arrows
  const arrows: { from: string; to: string; event: string; index: number }[] = [];
  for (const state of states) {
    for (const [i, t] of (state.transitions ?? []).entries()) {
      if (t.nextState) {
        arrows.push({ from: state.name, to: t.nextState, event: t.event, index: i });
      }
    }
  }

  return (
    <svg
      ref={svgRef}
      className="w-full h-full bg-gray-950"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={() => clearSelection()}
    >
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
        </marker>
      </defs>

      {/* Transition arrows */}
      {arrows.map((arrow, i) => {
        const from = getPos(arrow.from);
        const to = getPos(arrow.to);
        const fx = from.x + from.width / 2;
        const fy = from.y + from.height;
        const tx = to.x + to.width / 2;
        const ty = to.y;
        const midY = (fy + ty) / 2;

        return (
          <g key={`arrow-${i}`}>
            <path
              d={`M ${fx} ${fy} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={2}
              markerEnd="url(#arrowhead)"
              className="cursor-pointer hover:stroke-blue-400"
              onClick={(e) => {
                e.stopPropagation();
                select("transition", `${arrow.from}:${arrow.index}`);
              }}
            />
            <text
              x={(fx + tx) / 2}
              y={midY - 8}
              fill="#94a3b8"
              fontSize={12}
              textAnchor="middle"
              className="pointer-events-none select-none"
            >
              {arrow.event}
            </text>
          </g>
        );
      })}

      {/* State nodes */}
      {states.map((state) => {
        const pos = getPos(state.name);
        const isSelected = selection.kind === "state" && selection.id === state.name;
        const isFinal = state.kind === "final";

        return (
          <g
            key={state.name}
            onMouseDown={(e) => handleMouseDown(e, state.name)}
            className="cursor-grab active:cursor-grabbing"
          >
            <rect
              x={pos.x}
              y={pos.y}
              width={pos.width}
              height={pos.height}
              rx={isFinal ? 4 : 8}
              fill={isFinal ? "#1e293b" : "#0f172a"}
              stroke={isSelected ? "#3b82f6" : "#475569"}
              strokeWidth={isSelected ? 2.5 : 1.5}
              strokeDasharray={isFinal ? "6 3" : undefined}
            />
            {/* State name */}
            <text
              x={pos.x + pos.width / 2}
              y={pos.y + pos.height / 2 + 5}
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
          </g>
        );
      })}

      {/* Empty state message */}
      {states.length === 0 && (
        <text x="50%" y="50%" fill="#475569" fontSize={16} textAnchor="middle">
          Right-click to add a state, or load a .smdf.json file
        </text>
      )}
    </svg>
  );
}
