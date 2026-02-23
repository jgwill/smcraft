"use client";

import { useDesignerStore } from "@/store/useDesignerStore";

export default function CodePreview() {
  const generatedCode = useDesignerStore((s) => s.generatedCode);
  const showCodePreview = useDesignerStore((s) => s.showCodePreview);
  const setShowCodePreview = useDesignerStore((s) => s.setShowCodePreview);

  if (!showCodePreview) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-[80%] max-w-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">Generated Definition (JSON)</h3>
          <button
            onClick={() => setShowCodePreview(false)}
            className="text-gray-500 hover:text-gray-300 text-lg"
          >
            ✕
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-4 text-sm text-green-400 font-mono">
          {generatedCode ?? "No code generated yet"}
        </pre>
        <div className="flex justify-end px-4 py-2 border-t border-gray-800">
          <button
            onClick={() => {
              if (generatedCode) navigator.clipboard.writeText(generatedCode);
            }}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
}
