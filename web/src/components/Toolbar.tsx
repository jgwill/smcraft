"use client";

import { useRef, useState } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { StateDef } from "@/types/definition";

export default function Toolbar() {
  const definition = useDesignerStore((s) => s.definition);
  const fileName = useDesignerStore((s) => s.fileName);
  const dirty = useDesignerStore((s) => s.dirty);
  const loadFromJson = useDesignerStore((s) => s.loadFromJson);
  const exportJson = useDesignerStore((s) => s.exportJson);
  const addState = useDesignerStore((s) => s.addState);
  const addTransition = useDesignerStore((s) => s.addTransition);
  const validate = useDesignerStore((s) => s.validate);
  const showCodePreview = useDesignerStore((s) => s.showCodePreview);
  const setShowCodePreview = useDesignerStore((s) => s.setShowCodePreview);
  const setGeneratedCode = useDesignerStore((s) => s.setGeneratedCode);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addingState, setAddingState] = useState(false);
  const [newStateName, setNewStateName] = useState("");
  const [addingTransition, setAddingTransition] = useState(false);
  const [transFrom, setTransFrom] = useState("");
  const [transTo, setTransTo] = useState("");
  const [transEvent, setTransEvent] = useState("");

  const allStates: string[] = [];
  const collectNames = (s: StateDef) => {
    allStates.push(s.name);
    (s.states ?? []).forEach(collectNames);
  };
  collectNames(definition.state);
  const allEvents = definition.events.flatMap((src) => (src.events ?? []).map((e) => e.id));

  const handleOpen = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      loadFromJson(text, file.name);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSave = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName ?? "statemachine.smdf.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddState = () => {
    if (!newStateName.trim()) return;
    addState(null, { name: newStateName.trim(), kind: "normal" });
    setNewStateName("");
    setAddingState(false);
  };

  const handleAddTransition = () => {
    if (!transFrom || !transEvent) return;
    addTransition(transFrom, {
      event: transEvent,
      nextState: transTo || undefined,
    });
    setTransFrom("");
    setTransTo("");
    setTransEvent("");
    setAddingTransition(false);
  };

  const handleGenerate = () => {
    // Simple code preview — shows the JSON definition
    // Full code generation requires the smcraft/ts codegen module
    setGeneratedCode(exportJson());
    setShowCodePreview(true);
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.smdf.json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* File name */}
      <span className="text-sm text-gray-400 mr-2">
        {fileName ?? "untitled.smdf.json"}
        {dirty && <span className="text-yellow-500 ml-1">●</span>}
      </span>

      <div className="flex-1" />

      {/* File ops */}
      <button onClick={handleOpen} className="toolbar-btn" title="Open .smdf.json">
        📂 Open
      </button>
      <button onClick={handleSave} className="toolbar-btn" title="Save definition">
        💾 Save
      </button>

      <div className="w-px h-5 bg-gray-700 mx-1" />

      {/* Add state */}
      {addingState ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-sm text-gray-200 w-28"
            placeholder="State name..."
            value={newStateName}
            onChange={(e) => setNewStateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddState();
              if (e.key === "Escape") setAddingState(false);
            }}
          />
          <button onClick={handleAddState} className="toolbar-btn-sm">✓</button>
          <button onClick={() => setAddingState(false)} className="toolbar-btn-sm">✕</button>
        </div>
      ) : (
        <button onClick={() => setAddingState(true)} className="toolbar-btn">
          ＋ State
        </button>
      )}

      {/* Add transition */}
      {addingTransition ? (
        <div className="flex items-center gap-1">
          <select
            className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-sm text-gray-200"
            value={transFrom}
            onChange={(e) => setTransFrom(e.target.value)}
          >
            <option value="">From...</option>
            {allStates.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-sm text-gray-200"
            value={transEvent}
            onChange={(e) => setTransEvent(e.target.value)}
          >
            <option value="">Event...</option>
            {allEvents.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-sm text-gray-200"
            value={transTo}
            onChange={(e) => setTransTo(e.target.value)}
          >
            <option value="">To...</option>
            {allStates.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={handleAddTransition} className="toolbar-btn-sm">✓</button>
          <button onClick={() => setAddingTransition(false)} className="toolbar-btn-sm">✕</button>
        </div>
      ) : (
        <button onClick={() => setAddingTransition(true)} className="toolbar-btn">
          ＋ Transition
        </button>
      )}

      <div className="w-px h-5 bg-gray-700 mx-1" />

      {/* Validate & Generate */}
      <button onClick={() => validate()} className="toolbar-btn">
        ✓ Validate
      </button>
      <button onClick={handleGenerate} className="toolbar-btn">
        ⚡ Generate
      </button>
      <button
        onClick={() => setShowCodePreview(!showCodePreview)}
        className={`toolbar-btn ${showCodePreview ? "text-blue-400" : ""}`}
      >
        {"</>"} Code
      </button>
    </div>
  );
}
