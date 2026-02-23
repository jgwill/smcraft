"use client";

import Canvas from "@/components/Canvas";
import PropertiesPanel from "@/components/PropertiesPanel";
import EventsPanel from "@/components/EventsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import Toolbar from "@/components/Toolbar";
import CodePreview from "@/components/CodePreview";

export default function Home() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 overflow-hidden">
          <Canvas />
        </div>
        <div className="w-72 border-l border-gray-800 bg-gray-900 overflow-y-auto flex flex-col">
          <PropertiesPanel />
          <div className="border-t border-gray-800">
            <EventsPanel />
          </div>
          <div className="border-t border-gray-800">
            <ValidationPanel />
          </div>
        </div>
        <CodePreview />
      </div>
    </div>
  );
}

