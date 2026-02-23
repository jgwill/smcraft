"use client";

import { useDesignerStore } from "@/store/useDesignerStore";
import type { StateDef, TransitionDef } from "@/types/definition";
import { useState } from "react";

export default function PropertiesPanel() {
  const definition = useDesignerStore((s) => s.definition);
  const selection = useDesignerStore((s) => s.selection);
  const updateState = useDesignerStore((s) => s.updateState);
  const removeState = useDesignerStore((s) => s.removeState);
  const updateSettings = useDesignerStore((s) => s.updateSettings);
  const updateTransition = useDesignerStore((s) => s.updateTransition);
  const removeTransition = useDesignerStore((s) => s.removeTransition);

  if (!selection.kind || !selection.id) {
    return (
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">Settings</h3>
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-gray-500">Namespace</span>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
              value={definition.settings.namespace}
              onChange={(e) => updateSettings({ namespace: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Name</span>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
              value={definition.settings.name ?? ""}
              onChange={(e) => updateSettings({ name: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={definition.settings.asynchronous}
              onChange={(e) => updateSettings({ asynchronous: e.target.checked })}
              className="rounded bg-gray-800 border-gray-600"
            />
            Asynchronous
          </label>
        </div>
      </div>
    );
  }

  if (selection.kind === "state") {
    const findState = (root: StateDef, name: string): StateDef | null => {
      if (root.name === name) return root;
      for (const child of root.states ?? []) {
        const found = findState(child, name);
        if (found) return found;
      }
      return null;
    };
    const state = findState(definition.state, selection.id);
    if (!state) return <div className="p-4 text-gray-500">State not found</div>;

    return (
      <div className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-400">State: {state.name}</h3>
        <label className="block">
          <span className="text-xs text-gray-500">Name</span>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            value={state.name}
            onChange={(e) => updateState(selection.id!, { name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Kind</span>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            value={state.kind ?? "normal"}
            onChange={(e) => updateState(selection.id!, { kind: e.target.value as StateDef["kind"] })}
          >
            <option value="normal">Normal</option>
            <option value="final">Final</option>
            <option value="history">History</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Description</span>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 h-16"
            value={state.description ?? ""}
            onChange={(e) => updateState(selection.id!, { description: e.target.value })}
          />
        </label>

        {/* Transitions list */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 mt-2">Transitions</h4>
          {(state.transitions ?? []).map((t, i) => (
            <div key={i} className="flex items-center gap-1 text-xs text-gray-400 py-1 border-b border-gray-800">
              <span className="flex-1">{t.event} → {t.nextState ?? "(internal)"}</span>
              <button
                onClick={() => removeTransition(selection.id!, i)}
                className="text-red-500 hover:text-red-400 text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => removeState(selection.id!)}
          className="text-red-500 hover:text-red-400 text-xs mt-2"
        >
          Delete State
        </button>
      </div>
    );
  }

  if (selection.kind === "transition") {
    const [stateName, indexStr] = selection.id.split(":");
    const idx = parseInt(indexStr, 10);

    const findState = (root: StateDef, name: string): StateDef | null => {
      if (root.name === name) return root;
      for (const child of root.states ?? []) {
        const found = findState(child, name);
        if (found) return found;
      }
      return null;
    };
    const state = findState(definition.state, stateName);
    const trans = state?.transitions?.[idx];
    if (!trans) return <div className="p-4 text-gray-500">Transition not found</div>;

    const allEvents = definition.events.flatMap((src) => src.events ?? []);
    const allStates: string[] = [];
    const collectNames = (s: StateDef) => {
      allStates.push(s.name);
      (s.states ?? []).forEach(collectNames);
    };
    collectNames(definition.state);

    return (
      <div className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-400">Transition</h3>
        <label className="block">
          <span className="text-xs text-gray-500">Event</span>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            value={trans.event}
            onChange={(e) => updateTransition(stateName, idx, { event: e.target.value })}
          >
            {allEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.id}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Target State</span>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            value={trans.nextState ?? ""}
            onChange={(e) => updateTransition(stateName, idx, { nextState: e.target.value || undefined })}
          >
            <option value="">(internal transition)</option>
            {allStates.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Condition (guard)</span>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            value={trans.condition ?? ""}
            onChange={(e) => updateTransition(stateName, idx, { condition: e.target.value || undefined })}
          />
        </label>
        <button
          onClick={() => removeTransition(stateName, idx)}
          className="text-red-500 hover:text-red-400 text-xs"
        >
          Delete Transition
        </button>
      </div>
    );
  }

  return null;
}
