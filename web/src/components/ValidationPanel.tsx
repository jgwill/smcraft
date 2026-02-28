"use client";

import { useDesignerStore } from "@/store/useDesignerStore";

export default function ValidationPanel() {
  const errors = useDesignerStore((s) => s.errors);
  const validate = useDesignerStore((s) => s.validate);
  const select = useDesignerStore((s) => s.select);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400">
          Validation {errors.length > 0 && <span className="text-red-500">({errors.length})</span>}
        </h3>
        <button
          onClick={() => validate()}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded"
        >
          Re-check
        </button>
      </div>

      {errors.length === 0 ? (
        <div className="flex items-center gap-2 text-green-500 text-xs">
          <span>✓</span>
          <span>Definition is valid</span>
        </div>
      ) : (
        <div className="space-y-0.5">
          {errors.map((err, i) => (
            <div
              key={i}
              className={`flex items-start gap-1.5 text-xs py-1 border-b border-gray-800/50 ${
                err.element ? "cursor-pointer hover:bg-gray-800/30" : ""
              }`}
              onClick={() => {
                if (!err.element) return;
                // Determine if element is a state or event
                select("state", err.element);
              }}
              title={err.element ? `Click to select "${err.element}"` : undefined}
            >
              <span className={`font-mono text-[10px] mt-0.5 ${err.severity === "error" ? "text-red-600" : "text-yellow-600"}`}>
                {err.ruleId}
              </span>
              <span className={`flex-1 ${err.severity === "error" ? "text-red-400" : "text-yellow-400"}`}>
                {err.message}
              </span>
              {err.element && (
                <span className="text-gray-600 text-[10px]">→ {err.element}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
