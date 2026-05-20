"use client";

import { useRef, useState } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import { createAgentLifecycleTemplate } from "@/lib/templates";
import { generateMachineSpecification, generateTransitionContracts } from "@/lib/specification";

export default function Toolbar() {
  const fileName = useDesignerStore((s) => s.fileName);
  const dirty = useDesignerStore((s) => s.dirty);
  const loadFromJson = useDesignerStore((s) => s.loadFromJson);
  const exportJson = useDesignerStore((s) => s.exportJson);
  const definition = useDesignerStore((s) => s.definition);
  const addState = useDesignerStore((s) => s.addState);
  const setDefinition = useDesignerStore((s) => s.setDefinition);
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
  const viewport = useDesignerStore((s) => s.viewport);
  const zoomIn = useDesignerStore((s) => s.zoomIn);
  const zoomOut = useDesignerStore((s) => s.zoomOut);
  const resetViewport = useDesignerStore((s) => s.resetViewport);
  const requestFitToFrame = useDesignerStore((s) => s.requestFitToFrame);
  const canFit = useDesignerStore((s) => s.getCurrentChildren().length > 0);

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

  const handleLoadAgentLifecycle = () => {
    if (dirty && !window.confirm("Replace the current definition with the agent lifecycle starter?")) {
      return;
    }
    setDefinition(createAgentLifecycleTemplate());
  };

  const [generateLang, setGenerateLang] = useState<
    "python" | "typescript" | "specification" | "contracts" | "smdf"
  >("python");

  const handleGenerate = async () => {
    const json = exportJson();
    if (generateLang === "smdf") {
      setGeneratedCode(json);
      setShowCodePreview(true);
      return;
    }
    if (generateLang === "specification") {
      setGeneratedCode(generateMachineSpecification(definition));
      setShowCodePreview(true);
      return;
    }
    if (generateLang === "contracts") {
      setGeneratedCode(generateTransitionContracts(definition));
      setShowCodePreview(true);
      return;
    }
    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: json, language: generateLang }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setGeneratedCode(data.code);
      } else {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        setGeneratedCode(`// Code generation failed: ${err.error}\n// Showing definition JSON as fallback:\n${json}`);
      }
    } catch {
      setGeneratedCode(`// Backend unavailable — showing definition JSON\n${json}`);
    }
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

      {/* Zoom controls */}
      <button
        onClick={zoomOut}
        className="toolbar-btn-sm"
        title="Zoom out"
      >
        −
      </button>
      <button
        onClick={resetViewport}
        className="toolbar-btn-sm tabular-nums min-w-[42px] text-center"
        title="Reset to 100% and center"
      >
        {Math.round(viewport.scale * 100)}%
      </button>
      <button
        onClick={zoomIn}
        className="toolbar-btn-sm"
        title="Zoom in"
      >
        ＋
      </button>
      <button
        onClick={requestFitToFrame}
        disabled={!canFit}
        className="toolbar-btn-sm disabled:opacity-30"
        title="Fit diagram to frame"
      >
        ⊡
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
      <button onClick={handleLoadAgentLifecycle} className="toolbar-btn" title="Load agent lifecycle starter">
        🧭 Lifecycle
      </button>

      <div className="w-px h-4 bg-gray-700" />

      {/* Validate & Generate */}
      <button onClick={() => validate()} className="toolbar-btn">
        ✓ Validate
      </button>
      <select
        value={generateLang}
        onChange={(e) =>
          setGenerateLang(
            e.target.value as "python" | "typescript" | "specification" | "contracts" | "smdf"
          )
        }
        className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-1 py-0.5"
      >
        <option value="python">Python</option>
        <option value="typescript">TypeScript</option>
        <option value="smdf">SMDF JSON</option>
        <option value="specification">Lifecycle Spec</option>
        <option value="contracts">Transition Contracts</option>
      </select>
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
