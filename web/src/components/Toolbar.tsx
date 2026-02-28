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
  const validate = useDesignerStore((s) => s.validate);
  const showCodePreview = useDesignerStore((s) => s.showCodePreview);
  const setShowCodePreview = useDesignerStore((s) => s.setShowCodePreview);
  const setGeneratedCode = useDesignerStore((s) => s.setGeneratedCode);
  const drawMode = useDesignerStore((s) => s.drawMode);
  const setDrawMode = useDesignerStore((s) => s.setDrawMode);
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const undoStack = useDesignerStore((s) => s.undoStack);
  const redoStack = useDesignerStore((s) => s.redoStack);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addingState, setAddingState] = useState(false);
  const [newStateName, setNewStateName] = useState("");

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

  const handleGenerate = () => {
    setGeneratedCode(exportJson());
    setShowCodePreview(true);
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 border-b border-gray-800 flex-wrap">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.smdf.json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* File name */}
      <span className="text-xs text-gray-400 mr-1">
        {fileName ?? "untitled.smdf.json"}
        {dirty && <span className="text-yellow-500 ml-0.5">●</span>}
      </span>

      <div className="flex-1" />

      {/* Undo/Redo */}
      <button
        onClick={undo}
        disabled={undoStack.length === 0}
        className="toolbar-btn disabled:opacity-30"
        title="Undo (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        onClick={redo}
        disabled={redoStack.length === 0}
        className="toolbar-btn disabled:opacity-30"
        title="Redo (Ctrl+Y)"
      >
        ↪
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* Draw mode toggle */}
      <button
        onClick={() => setDrawMode(drawMode === "select" ? "transition" : "select")}
        className={`toolbar-btn ${drawMode === "transition" ? "!bg-amber-700 !text-white" : ""}`}
        title={drawMode === "transition" ? "Exit draw mode (Esc)" : "Draw transition mode"}
      >
        {drawMode === "transition" ? "✏️ Drawing" : "↗ Draw"}
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* File ops */}
      <button onClick={handleOpen} className="toolbar-btn" title="Open .smdf.json">
        📂
      </button>
      <button onClick={handleSave} className="toolbar-btn" title="Save">
        💾
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* Add state */}
      {addingState ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-24"
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
          ＋State
        </button>
      )}

      <div className="w-px h-4 bg-gray-700" />

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
