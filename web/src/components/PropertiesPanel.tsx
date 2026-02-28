"use client";

import { useDesignerStore, collectAllStates, collectEventIds } from "@/store/useDesignerStore";
import type { StateDef, ActionDef } from "@/types/definition";

function ActionEditor({ label, actions, onChange }: { label: string; actions: ActionDef[]; onChange: (actions: ActionDef[]) => void }) {
  const addAction = () => onChange([...actions, { action: "code", code: "" }]);
  const removeAction = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const updateAction = (i: number, patch: Partial<ActionDef>) => onChange(actions.map((a, idx) => idx === i ? { ...a, ...patch } : a));

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <button onClick={addAction} className="text-xs text-blue-500 hover:text-blue-400">+ action</button>
      </div>
      {actions.map((a, i) => (
        <div key={i} className="flex items-start gap-1 mt-1">
          <select
            className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200"
            value={a.action}
            onChange={(e) => updateAction(i, { action: e.target.value as ActionDef["action"] })}
          >
            <option value="code">Code</option>
            <option value="timerStart">Timer Start</option>
            <option value="timerStop">Timer Stop</option>
          </select>
          {a.action === "code" ? (
            <textarea
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 h-10 font-mono"
              value={a.code ?? ""}
              placeholder="// action code..."
              onChange={(e) => updateAction(i, { code: e.target.value })}
            />
          ) : (
            <input
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200"
              value={a.name ?? ""}
              placeholder="Timer name"
              onChange={(e) => updateAction(i, { name: e.target.value })}
            />
          )}
          <button onClick={() => removeAction(i)} className="text-red-600 hover:text-red-400 text-xs mt-0.5">✕</button>
        </div>
      ))}
      {actions.length === 0 && <span className="text-xs text-gray-700 italic">none</span>}
    </div>
  );
}

export default function PropertiesPanel() {
  const definition = useDesignerStore((s) => s.definition);
  const selection = useDesignerStore((s) => s.selection);
  const updateState = useDesignerStore((s) => s.updateState);
  const removeState = useDesignerStore((s) => s.removeState);
  const addAction = useDesignerStore((s) => s.addAction);
  const removeAction = useDesignerStore((s) => s.removeAction);
  const updateTransition = useDesignerStore((s) => s.updateTransition);
  const removeTransition = useDesignerStore((s) => s.removeTransition);

  if (!selection.kind || !selection.id) {
    return (
      <div className="p-3 text-xs text-gray-500">
        Select a state or transition to edit its properties.
      </div>
    );
  }

  const findState = (root: StateDef, name: string): StateDef | null => {
    if (root.name === name) return root;
    for (const child of root.states ?? []) {
      const found = findState(child, name);
      if (found) return found;
    }
    return null;
  };

  if (selection.kind === "state") {
    const state = findState(definition.state, selection.id);
    if (!state) return <div className="p-3 text-gray-500 text-xs">State not found</div>;

    const entryActions = state.onEntry?.actions ?? [];
    const exitActions = state.onExit?.actions ?? [];

    return (
      <div className="p-3 space-y-3 text-sm overflow-y-auto max-h-[calc(100vh-160px)]">
        <h3 className="text-xs font-semibold text-gray-400">State: {state.name}</h3>
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
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 h-12"
            value={state.description ?? ""}
            onChange={(e) => updateState(selection.id!, { description: e.target.value || undefined })}
          />
        </label>

        {/* onEntry actions */}
        <ActionEditor
          label="▸ onEntry Actions"
          actions={entryActions}
          onChange={(actions) => updateState(selection.id!, { onEntry: { actions } })}
        />

        {/* onExit actions */}
        <ActionEditor
          label="◂ onExit Actions"
          actions={exitActions}
          onChange={(actions) => updateState(selection.id!, { onExit: { actions } })}
        />

        {/* Transitions list */}
        <div>
          <span className="text-xs font-medium text-gray-500">Transitions</span>
          {(state.transitions ?? []).map((t, i) => (
            <div key={i} className="flex items-center gap-1 text-xs text-gray-400 py-1 border-b border-gray-800/50">
              <span className="flex-1">{t.event} → {t.nextState ?? "(internal)"}</span>
              {t.condition && <span className="text-gray-600">[{t.condition}]</span>}
              <button
                onClick={() => removeTransition(selection.id!, i)}
                className="text-red-600 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
          {(state.transitions?.length ?? 0) === 0 && (
            <span className="text-xs text-gray-700 italic">none</span>
          )}
        </div>

        <button
          onClick={() => removeState(selection.id!)}
          className="text-red-500 hover:text-red-400 text-xs mt-2"
        >
          🗑 Delete State
        </button>
      </div>
    );
  }

  if (selection.kind === "transition") {
    const [stateName, indexStr] = selection.id.split(":");
    const idx = parseInt(indexStr, 10);
    const state = findState(definition.state, stateName);
    const trans = state?.transitions?.[idx];
    if (!trans) return <div className="p-3 text-gray-500 text-xs">Transition not found</div>;

    const allEvents = collectEventIds(definition);
    const allStateNames = collectAllStates(definition.state).map((s) => s.name).filter((n) => n !== "Root");

    return (
      <div className="p-3 space-y-3 text-sm">
        <h3 className="text-xs font-semibold text-gray-400">Transition</h3>
        <label className="block">
          <span className="text-xs text-gray-500">Event</span>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            value={trans.event}
            onChange={(e) => updateTransition(stateName, idx, { event: e.target.value })}
          >
            {allEvents.map((ev) => (
              <option key={ev} value={ev}>{ev}</option>
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
            {allStateNames.map((name) => (
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
          🗑 Delete Transition
        </button>
      </div>
    );
  }

  return null;
}
