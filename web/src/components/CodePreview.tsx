"use client";

import { useDesignerStore } from "@/store/useDesignerStore";

export default function CodePreview() {
  const generatedCode = useDesignerStore((s) => s.generatedCode);
  const showCodePreview = useDesignerStore((s) => s.showCodePreview);
  const setShowCodePreview = useDesignerStore((s) => s.setShowCodePreview);

  if (!showCodePreview) return null;

  return (
    // `80%` of a 390px phone left a 78px gutter of wasted screen around already
    // cramped code, so the modal goes near-full-bleed below `md` and returns to
    // the centred 80% dialog above it. `dvh` for the height cap for the same
    // reason the shell uses it: `80vh` measures the URL-bar-less viewport and
    // pushed the Copy button off the bottom on iOS.
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-2 md:p-0">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-h-[85dvh] md:w-[80%] md:max-w-3xl md:max-h-[80dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">Generated Definition (JSON)</h3>
          <button
            onClick={() => setShowCodePreview(false)}
            className="text-gray-500 hover:text-gray-300 text-lg min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>
        {/* `overscroll-contain` stops a flick past the end of the code from
            scrolling whatever is behind the modal. */}
        <pre className="flex-1 overflow-auto overscroll-contain p-4 text-[11px] leading-relaxed text-green-400 font-mono md:text-sm">
          {generatedCode ?? "No code generated yet"}
        </pre>
        <div className="flex justify-end px-4 py-2 border-t border-gray-800">
          <button
            onClick={() => {
              if (generatedCode) navigator.clipboard.writeText(generatedCode);
            }}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 py-3 rounded md:px-3 md:py-1"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
}
