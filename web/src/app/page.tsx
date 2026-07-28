"use client";

import { useState, type CSSProperties } from "react";
import Canvas from "@/components/Canvas";
import PropertiesPanel from "@/components/PropertiesPanel";
import EventsPanel from "@/components/EventsPanel";
import SettingsPanel from "@/components/SettingsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import Toolbar from "@/components/Toolbar";
import CodePreview from "@/components/CodePreview";
import DesignBridge from "@/components/DesignBridge";
import { useDesignerStore } from "@/store/useDesignerStore";

type Tab = "properties" | "events" | "settings" | "validation";

/**
 * Place the context menu at the press point, opening toward the middle of the
 * screen. A long-press near the right or bottom edge of a phone would otherwise
 * render the menu partly off-screen — a max-width alone only rescues the
 * horizontal case, and nothing rescued the vertical one, which is exactly where
 * a thumb naturally rests.
 *
 * Flipping past the midpoint rather than measuring the menu is deliberate: a
 * measure-then-correct pass would paint the menu once at the wrong place and
 * visibly snap. The menu is small relative to half a screen, so the midpoint is
 * a sufficient proxy for "would this overflow".
 */
function contextMenuPlacement(x: number, y: number): CSSProperties {
  const w = typeof window === "undefined" ? 0 : window.innerWidth;
  const h = typeof window === "undefined" ? 0 : window.innerHeight;
  const flipX = w > 0 && x > w / 2;
  const flipY = h > 0 && y > h / 2;
  return {
    left: x,
    top: y,
    maxWidth: "calc(100vw - 1rem)",
    maxHeight: "calc(100dvh - 1rem)",
    overflowY: "auto",
    transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("properties");
  // Phone-only state. The panel column and the bottom sheet are the same
  // element: below `md` it is an overlay that starts closed so the canvas owns
  // the entire screen, and at `md` and up the responsive classes pin it open as
  // the 320px right sidebar it has always been — this flag stops mattering.
  const [sheetOpen, setSheetOpen] = useState(false);
  const errors = useDesignerStore((s) => s.errors);
  const contextMenu = useDesignerStore((s) => s.contextMenu);
  const hideContextMenu = useDesignerStore((s) => s.hideContextMenu);
  const addState = useDesignerStore((s) => s.addState);
  const removeState = useDesignerStore((s) => s.removeState);
  const setDrawMode = useDesignerStore((s) => s.setDrawMode);
  const setDrawSource = useDesignerStore((s) => s.setDrawSource);

  const tabs: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: "properties", label: "Properties", icon: "🎛" },
    { id: "events", label: "Events", icon: "⚡" },
    { id: "settings", label: "Settings", icon: "⚙" },
    { id: "validation", label: "Errors", icon: "⚠", badge: errors.length || undefined },
  ];

  const activeLabel = tabs.find((t) => t.id === activeTab)?.label ?? "";

  // Tapping the tab you are already reading closes the sheet, so the dock is
  // both switcher and dismiss control and no screen height is spent on a
  // separate close affordance.
  const toggleTab = (id: Tab) => {
    setSheetOpen((wasOpen) => !(wasOpen && activeTab === id));
    setActiveTab(id);
  };

  return (
    <div
      className="app-shell dock-offset flex flex-col overflow-hidden"
      onClick={() => contextMenu.visible && hideContextMenu()}
    >
      <DesignBridge />
      <Toolbar />
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Canvas */}
        <div className="flex-1 overflow-hidden">
          <Canvas />
        </div>

        {/* Scrim. Phone only — it is what makes "tap the canvas to dismiss"
            work without stealing the canvas's own pointer handlers when the
            sheet is closed. */}
        {sheetOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Panel column. One element, two shapes: a bottom sheet that slides
            over the canvas on a phone, and the unchanged `w-80` right sidebar
            from `md` up. The `md:` overrides have to undo every phone-only
            declaration — position, height, width, transform, radius, border
            side — which is why the class list is long. */}
        <aside
          className={`safe-x fixed inset-x-0 bottom-0 z-30 h-[70dvh] flex flex-col overflow-hidden rounded-t-2xl border-t border-gray-800 bg-gray-900 shadow-2xl transition-transform duration-200 ease-out ${
            sheetOpen ? "translate-y-0" : "translate-y-full pointer-events-none"
          } md:static md:z-auto md:h-auto md:w-80 md:translate-y-0 md:pointer-events-auto md:rounded-none md:border-t-0 md:border-l md:shadow-none md:transition-none`}
        >
          {/* Sheet header (phone). The grab handle reads as "this thing is a
              sheet"; the dock below already names the tabs, so repeating the
              tab bar here would only cost height. */}
          <div className="md:hidden">
            <div className="flex justify-center pt-2 pb-1">
              <span className="h-1 w-10 rounded-full bg-gray-700" />
            </div>
            <div className="flex items-center justify-between border-b border-gray-800 px-4 pb-2">
              <h2 className="text-sm font-semibold text-gray-300">{activeLabel}</h2>
              <button
                onClick={() => setSheetOpen(false)}
                className="-mr-2 px-3 py-2 text-lg text-gray-400"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tab bar (desktop). Hidden on a phone because the fixed dock at the
              bottom of the screen is the switcher there — thumbs live at the
              bottom edge, not the top of a sheet. */}
          <div className="hidden border-b border-gray-800 md:flex">
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

          {/* Tab content. `touch-targets` is the hook the coarse-pointer block
              in globals.css uses to grow every control inside the panels to
              44px — one class instead of a responsive rewrite of four panels.
              `dock-offset` keeps the last row of a panel from ending up behind
              the dock, which paints over the bottom of the sheet. */}
          <div className="touch-targets dock-offset flex-1 overflow-y-auto overscroll-contain">
            {activeTab === "properties" && <PropertiesPanel />}
            {activeTab === "events" && <EventsPanel />}
            {activeTab === "settings" && <SettingsPanel />}
            {activeTab === "validation" && <ValidationPanel />}
          </div>
        </aside>

        <CodePreview />
      </div>

      {/* Tab dock (phone). Fixed to the bottom edge so the four panels stay one
          thumb-tap away without ever occupying canvas width, and so the error
          count — the one thing a user most needs to notice — is on screen at all
          times rather than hidden inside a closed drawer. */}
      <nav className="dock-safe safe-x fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-800 bg-gray-900/95 backdrop-blur-md md:hidden">
        {tabs.map((tab) => {
          const current = sheetOpen && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => toggleTab(tab.id)}
              aria-pressed={current}
              className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                current ? "text-blue-400" : "text-gray-500"
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="absolute top-1 right-1/2 translate-x-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 text-white min-w-[16px]">
                  {tab.badge}
                </span>
              )}
              {current && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-blue-400" />}
            </button>
          );
        })}
      </nav>

      {/* Context menu. `contextMenu` is always an object — the `visible` flag is
          what says whether it was opened, so gating on the object alone left the
          menu parked over the top-left of the canvas from first paint.
          Placement is inline rather than Tailwind arbitrary values because it
          depends on where the press landed — see `contextMenuPlacement`. */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] md:min-w-[140px]"
          style={contextMenuPlacement(contextMenu.x, contextMenu.y)}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.target?.kind === "state" ? (
            <>
              <button
                className="block w-full text-left text-sm text-gray-300 hover:bg-gray-800 px-4 py-3 md:text-xs md:px-3 md:py-1.5"
                onClick={() => {
                  setDrawMode("transition");
                  setDrawSource(contextMenu.target!.id!);
                  hideContextMenu();
                }}
              >
                ↗ Draw transition from here
              </button>
              <button
                className="block w-full text-left text-sm text-red-400 hover:bg-gray-800 px-4 py-3 md:text-xs md:px-3 md:py-1.5"
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
                className="block w-full text-left text-sm text-gray-300 hover:bg-gray-800 px-4 py-3 md:text-xs md:px-3 md:py-1.5"
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
