"use client";

import { useRef, useState } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import {
  downloadCanvas,
  EXPORT_FORMATS,
  FORMAT_LABEL,
  type ExportFormat,
} from "@/lib/exportImage";
import type { StateDef } from "@/types/definition";

export default function Toolbar() {
  const definition = useDesignerStore((s) => s.definition);
  const fileName = useDesignerStore((s) => s.fileName);
  const docPath = useDesignerStore((s) => s.docPath);
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
  const arrangeLayout = useDesignerStore((s) => s.arrangeLayout);
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const undoStack = useDesignerStore((s) => s.undoStack);
  const redoStack = useDesignerStore((s) => s.redoStack);

  const remoteStatus = useDesignerStore((s) => s.remoteStatus);
  const remoteMessage = useDesignerStore((s) => s.remoteMessage);
  const setRemoteStatus = useDesignerStore((s) => s.setRemoteStatus);
  const setRemoteMtime = useDesignerStore((s) => s.setRemoteMtime);
  const applyRemote = useDesignerStore((s) => s.applyRemote);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addingState, setAddingState] = useState(false);
  const [newStateName, setNewStateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageFormat, setImageFormat] = useState<ExportFormat>("png");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);

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

  const handleSaveDisk = async () => {
    const json = exportJson();
    setSaving(true);
    try {
      const r = await fetch("/api/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: json }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "unknown" }));
        setRemoteStatus("error", `Save failed: ${err.error ?? r.statusText}`);
      } else {
        const data = await r.json();
        setRemoteMtime(data.mtime);
        useDesignerStore.setState({ dirty: false });
        setRemoteStatus("synced", null);
      }
    } catch (e) {
      setRemoteStatus("error", `Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName ?? "statemachine.smdf.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // The board as a file. For the picture formats, whatever is on the canvas is
  // what gets written — hand-dragged boxes included — so it matches the screen
  // it came from; mermaid and markdown come from the definition, which is all a
  // graph description can carry. The name it lands under is worth showing,
  // because it carries the episode, the machine and the minute.
  const handleExportImage = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const name = await downloadCanvas(imageFormat, { definition, docPath, fileName });
      setExported(name);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleReloadFromDisk = async () => {
    try {
      const r = await fetch("/api/file", { cache: "no-store" });
      if (!r.ok) {
        setRemoteStatus("error", "Reload failed");
        return;
      }
      const data = await r.json();
      if (data.exists && data.content) {
        applyRemote(data.content, data.mtime, data.path.split("/").pop());
      } else {
        setRemoteStatus("idle", `No file at ${data.path}`);
      }
    } catch (e) {
      setRemoteStatus("error", `Reload failed: ${e}`);
    }
  };

  const handleAddState = () => {
    if (!newStateName.trim()) return;
    addState(null, { name: newStateName.trim(), kind: "normal" });
    setNewStateName("");
    setAddingState(false);
  };

  const [generateLang, setGenerateLang] = useState<"python" | "typescript">("python");

  const handleGenerateRispec = async () => {
    try {
      const r = await fetch("/api/rispec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (r.ok) {
        const data = await r.json();
        setGeneratedCode(data.rispec);
      } else {
        const err = await r.json().catch(() => ({ error: "Unknown" }));
        setGeneratedCode(`# RISE rispec generation failed\n${err.error}`);
      }
    } catch (e) {
      setGeneratedCode(`# RISE rispec generation failed\n${e}`);
    }
    setShowCodePreview(true);
  };

  const handleGenerate = async () => {
    const json = exportJson();
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
    // Two shapes from one tree. On a phone the toolbar stacks: an identity line
    // over a horizontally-scrollable strip of controls, because fifteen buttons
    // will not fit 390px and wrapping them costs four rows of screen. From `md`
    // up both wrappers dissolve (`display: contents`, see globals.css) and the
    // buttons become direct children of this flex row again — same order, same
    // spacer, same wrap behaviour as before.
    <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-gray-900 border-b border-gray-800 md:flex-row md:flex-wrap md:items-center md:px-3">
      <div className="toolbar-ident">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.smdf.json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* File name + bridge status */}
        <span className="text-xs text-gray-400 mr-1 truncate max-w-[50vw] md:max-w-none">
          {fileName ?? "untitled.smdf.json"}
          {dirty && <span className="text-yellow-500 ml-0.5">●</span>}
        </span>
        {remoteStatus === "synced" && (
          <span className="text-[10px] text-emerald-500" title="In sync with disk">⌁ synced</span>
        )}
        {remoteStatus === "remote-changed" && (
          <span className="text-[10px] text-amber-400" title={remoteMessage ?? ""}>↻ remote changed</span>
        )}
        {remoteStatus === "error" && (
          <span className="text-[10px] text-red-400" title={remoteMessage ?? ""}>⚠ disk error</span>
        )}
        {remoteStatus === "idle" && (
          <span className="text-[10px] text-gray-600" title={remoteMessage ?? "No file bound"}>○ no disk</span>
        )}

        <div className="flex-1" />
      </div>

      <div className="toolbar-strip">
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

      {/* Auto-arrange — re-derive the layered layout over hand-placed boxes */}
      <button
        onClick={arrangeLayout}
        className="toolbar-btn"
        title="Arrange states into layers (auto-layout)"
      >
        ⤢ Arrange
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
      <button onClick={handleOpen} className="toolbar-btn" title="Open local .smdf.json (browser)">
        📂
      </button>
      <button
        onClick={handleSaveDisk}
        disabled={saving}
        className="toolbar-btn disabled:opacity-40"
        title="Save to disk (STATELOOM_PROJECT_FILE)"
      >
        💾 Disk
      </button>
      <button
        onClick={handleReloadFromDisk}
        className="toolbar-btn"
        title="Reload from disk"
      >
        🔄
      </button>
      <button onClick={handleDownload} className="toolbar-btn" title="Download as file">
        📥
      </button>

      {/* Export the board — pictures from the canvas as it stands, mermaid and
          markdown from the definition. */}
      <select
        value={imageFormat}
        onChange={(e) => {
          setImageFormat(e.target.value as ExportFormat);
          setExported(null);
          setExportError(null);
        }}
        className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-1 py-0.5"
        title="Export format"
      >
        {EXPORT_FORMATS.map((f) => (
          <option key={f} value={f}>
            {FORMAT_LABEL[f]}
          </option>
        ))}
      </select>
      <button
        onClick={handleExportImage}
        disabled={exporting}
        className={`toolbar-btn disabled:opacity-40 ${exportError ? "!text-red-400" : ""}`}
        title={exportError ?? `Export the board as ${FORMAT_LABEL[imageFormat]}`}
      >
        {exporting ? "…" : "🖼 Export"}
      </button>
      {exported && !exportError && (
        <span className="text-[10px] text-emerald-500 truncate max-w-[40vw] md:max-w-[16rem]" title={exported}>
          ⤓ {exported}
        </span>
      )}

      <div className="w-px h-4 bg-gray-700" />

      {/* Add state */}
      {addingState ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200 w-32 md:w-24"
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
      <select
        value={generateLang}
        onChange={(e) => setGenerateLang(e.target.value as "python" | "typescript")}
        className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-1 py-0.5"
      >
        <option value="python">Python</option>
        <option value="typescript">TypeScript</option>
      </select>
      <button onClick={handleGenerate} className="toolbar-btn">
        ⚡ Generate
      </button>
      <button onClick={handleGenerateRispec} className="toolbar-btn" title="Generate RISE rispec markdown">
        📜 RISE
      </button>
      <button
        onClick={() => setShowCodePreview(!showCodePreview)}
        className={`toolbar-btn ${showCodePreview ? "text-blue-400" : ""}`}
      >
        {"</>"} Code
      </button>
      </div>
    </div>
  );
}
