"use client";

import { useState } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { EventDef } from "@/types/definition";

const PARAM_TYPES = ["string", "int", "float", "bool", "object"];

export default function EventsPanel() {
  const definition = useDesignerStore((s) => s.definition);
  const addEvent = useDesignerStore((s) => s.addEvent);
  const updateEvent = useDesignerStore((s) => s.updateEvent);
  const removeEvent = useDesignerStore((s) => s.removeEvent);
  const addParameter = useDesignerStore((s) => s.addParameter);
  const removeParameter = useDesignerStore((s) => s.removeParameter);
  const updateParameter = useDesignerStore((s) => s.updateParameter);
  const updateEventSource = useDesignerStore((s) => s.updateEventSource);
  const select = useDesignerStore((s) => s.select);
  const selection = useDesignerStore((s) => s.selection);

  const [newEventId, setNewEventId] = useState("");
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);

  return (
    <div className="p-3 text-sm">
      {/* Event sources */}
      {definition.events.map((source, srcIdx) => (
        <div key={srcIdx} className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-500">Source:</span>
            <input
              className="flex-1 bg-transparent border-b border-gray-700 text-xs text-gray-300 px-1 py-0.5 focus:border-blue-500 outline-none"
              value={source.name}
              onChange={(e) => updateEventSource(srcIdx, { name: e.target.value })}
            />
            {source.feeder !== undefined && (
              <input
                className="w-24 bg-transparent border-b border-gray-700 text-xs text-gray-400 px-1 py-0.5 focus:border-blue-500 outline-none"
                value={source.feeder ?? ""}
                placeholder="Feeder..."
                onChange={(e) => updateEventSource(srcIdx, { feeder: e.target.value || undefined })}
              />
            )}
            {source.feeder === undefined && (
              <button
                className="text-xs text-gray-600 hover:text-gray-400"
                title="Add feeder class"
                onClick={() => updateEventSource(srcIdx, { feeder: `${source.name}Feeder` })}
              >
                +feeder
              </button>
            )}
          </div>

          {/* Events table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-600 border-b border-gray-800">
                <th className="text-left py-1 font-medium">ID</th>
                <th className="text-left py-1 font-medium">Description</th>
                <th className="text-left py-1 font-medium">Params</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {(source.events ?? []).map((evt) => (
                <>
                  <tr
                    key={evt.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer ${
                      selection.kind === "event" && selection.id === evt.id ? "bg-blue-900/30" : ""
                    }`}
                    onClick={() => {
                      select("event", evt.id);
                      setExpandedEvent(expandedEvent === evt.id ? null : evt.id);
                    }}
                  >
                    <td className="py-1 pr-1">
                      {editingEvent === evt.id ? (
                        <input
                          autoFocus
                          className="w-full bg-gray-800 border border-gray-700 rounded px-1 text-gray-200"
                          value={evt.id}
                          onChange={(e) => updateEvent(evt.id, { id: e.target.value })}
                          onBlur={() => setEditingEvent(null)}
                          onKeyDown={(e) => e.key === "Enter" && setEditingEvent(null)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="text-gray-300"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingEvent(evt.id);
                          }}
                        >
                          {evt.id}
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-1 text-gray-500 truncate max-w-[80px]">
                      {evt.description ?? "—"}
                    </td>
                    <td className="py-1 text-gray-500">
                      {(evt.parameters?.length ?? 0) > 0
                        ? evt.parameters!.map((p) => `${p.name}:${p.type}`).join(", ")
                        : "—"}
                    </td>
                    <td className="py-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); removeEvent(evt.id); }}
                        className="text-red-600 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  {/* Expanded row for editing */}
                  {expandedEvent === evt.id && (
                    <tr key={`${evt.id}-details`}>
                      <td colSpan={4} className="py-2 px-1 bg-gray-900/50">
                        <div className="space-y-2">
                          <label className="block">
                            <span className="text-gray-600">Description</span>
                            <input
                              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200 mt-0.5"
                              value={evt.description ?? ""}
                              onChange={(e) => updateEvent(evt.id, { description: e.target.value || undefined })}
                            />
                          </label>
                          {/* Parameters */}
                          <div>
                            <span className="text-gray-600">Parameters</span>
                            {(evt.parameters ?? []).map((p, pi) => (
                              <div key={pi} className="flex items-center gap-1 mt-1">
                                <input
                                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-200"
                                  value={p.name}
                                  placeholder="name"
                                  onChange={(e) => updateParameter(evt.id, pi, { name: e.target.value })}
                                />
                                <select
                                  className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-200"
                                  value={p.type}
                                  onChange={(e) => updateParameter(evt.id, pi, { type: e.target.value })}
                                >
                                  {PARAM_TYPES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => removeParameter(evt.id, pi)}
                                  className="text-red-600 hover:text-red-400"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              className="text-blue-500 hover:text-blue-400 mt-1"
                              onClick={() => addParameter(evt.id, { name: "param", type: "string" })}
                            >
                              + parameter
                            </button>
                          </div>
                          {/* Generated method preview */}
                          <div className="mt-1">
                            <span className="text-gray-600">Generated method:</span>
                            <code className="block bg-gray-800 rounded px-2 py-1 text-green-400 mt-0.5 font-mono">
                              on_{evt.id.toLowerCase()}(context
                              {(evt.parameters ?? []).map((p) => `, ${p.name}: ${p.type}`).join("")}
                              )
                            </code>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Add event */}
      <div className="flex gap-1 mt-2">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200"
          placeholder="New event ID..."
          value={newEventId}
          onChange={(e) => setNewEventId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newEventId.trim()) {
              addEvent({ id: newEventId.trim() });
              setNewEventId("");
            }
          }}
        />
        <button
          onClick={() => {
            if (newEventId.trim()) {
              addEvent({ id: newEventId.trim() });
              setNewEventId("");
            }
          }}
          className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded"
        >
          +
        </button>
      </div>
    </div>
  );
}
