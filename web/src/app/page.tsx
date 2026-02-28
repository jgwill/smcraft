"use client";

import { useState } from "react";
import Canvas from "@/components/Canvas";
import PropertiesPanel from "@/components/PropertiesPanel";
import EventsPanel from "@/components/EventsPanel";
import SettingsPanel from "@/components/SettingsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import Toolbar from "@/components/Toolbar";
import CodePreview from "@/components/CodePreview";
import { useDesignerStore } from "@/store/useDesignerStore";

type Tab = "properties" | "events" | "settings" | "validation";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("properties");
  const errors = useDesignerStore((s) => s.errors);
  const contextMenu = useDesignerStore((s) => s.contextMenu);
  const hideContextMenu = useDesignerStore((s) => s.hideContextMenu);
  const addState = useDesignerStore((s) => s.addState);
  const removeState = useDesignerStore((s) => s.removeState);
  const setDrawMode = useDesignerStore((s) => s.setDrawMode);
  const setDrawSource = useDesignerStore((s) => s.setDrawSource);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "properties", label: "Properties" },
    { id: "events", label: "Events" },
    { id: "settings", label: "Settings" },
    { id: "validation", label: "Errors", badge: errors.length || undefined },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden" onClick={() => contextMenu && hideContextMenu()}>
      <Toolbar />
      <div className="flex flex-1 overflow-hidden relative">
        {/* Canvas */}
        <div className="flex-1 overflow-hidden">
          <Canvas />
        </div>

        {/* Right sidebar with tabs */}
        <div className="w-80 border-l border-gray-800 bg-gray-900 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 text-xs py-2 px-1 text-center transition-colors relative ${
                  activeTab === tab.id
                    ? "text-blue-400 border-b-2 border-blue-400 bg-gray-800/50"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute top-1 right-1 bg-red-600 text-white text-[9px] rounded-full px-1 min-w-[14px]">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "properties" && <PropertiesPanel />}
            {activeTab === "events" && <EventsPanel />}
            {activeTab === "settings" && <SettingsPanel />}
            {activeTab === "validation" && <ValidationPanel />}
          </div>
        </div>

        <CodePreview />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.target?.kind === "state" ? (
            <>
              <button
                className="block w-full text-left text-xs text-gray-300 hover:bg-gray-800 px-3 py-1.5"
                onClick={() => {
                  setDrawMode("transition");
                  setDrawSource(contextMenu.target!.id!);
                  hideContextMenu();
                }}
              >
                ↗ Draw transition from here
              </button>
              <button
                className="block w-full text-left text-xs text-red-400 hover:bg-gray-800 px-3 py-1.5"
                onClick={() => {
                  if (contextMenu.target?.id) removeState(contextMenu.target.id);
                  hideContextMenu();
                }}
              >
                🗑 Delete state
              </button>
            </>
          ) : (
            <>
              <button
                className="block w-full text-left text-xs text-gray-300 hover:bg-gray-800 px-3 py-1.5"
                onClick={() => {
                  const name = prompt("State name:");
                  if (name) addState(null, { name, kind: "normal" });
                  hideContextMenu();
                }}
              >
                ＋ Add state here
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
