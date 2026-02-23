"use client";

import { useState } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";

export default function EventsPanel() {
  const definition = useDesignerStore((s) => s.definition);
  const addEvent = useDesignerStore((s) => s.addEvent);
  const removeEvent = useDesignerStore((s) => s.removeEvent);
  const select = useDesignerStore((s) => s.select);
  const selection = useDesignerStore((s) => s.selection);
  const [newEventId, setNewEventId] = useState("");

  const allEvents = definition.events.flatMap((src) => src.events ?? []);

  const handleAddEvent = () => {
    if (!newEventId.trim()) return;
    addEvent({ id: newEventId.trim() });
    setNewEventId("");
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-2">Events</h3>

      {/* Event list */}
      <div className="space-y-1 mb-3">
        {allEvents.map((evt) => (
          <div
            key={evt.id}
            className={`flex items-center justify-between px-2 py-1 rounded text-sm cursor-pointer ${
              selection.kind === "event" && selection.id === evt.id
                ? "bg-blue-900/50 text-blue-300"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            onClick={() => select("event", evt.id)}
          >
            <span>{evt.id}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeEvent(evt.id);
              }}
              className="text-red-500 hover:text-red-400 text-xs"
            >
              ✕
            </button>
          </div>
        ))}
        {allEvents.length === 0 && (
          <p className="text-xs text-gray-600">No events yet</p>
        )}
      </div>

      {/* Add event */}
      <div className="flex gap-1">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
          placeholder="Event ID..."
          value={newEventId}
          onChange={(e) => setNewEventId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddEvent()}
        />
        <button
          onClick={handleAddEvent}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-2 py-1 rounded"
        >
          +
        </button>
      </div>
    </div>
  );
}
