"use client";

import { useDesignerStore } from "@/store/useDesignerStore";

export default function ValidationPanel() {
  const errors = useDesignerStore((s) => s.errors);
  const validate = useDesignerStore((s) => s.validate);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-400">Validation</h3>
        <button
          onClick={() => validate()}
          className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded"
        >
          Re-check
        </button>
      </div>

      {errors.length === 0 ? (
        <div className="flex items-center gap-2 text-green-500 text-sm">
          <span>✓</span>
          <span>Definition is valid</span>
        </div>
      ) : (
        <div className="space-y-1">
          {errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-sm text-red-400 py-1 border-b border-gray-800"
            >
              <span className="text-red-600 font-mono text-xs mt-0.5">{err.ruleId}</span>
              <span className="flex-1">{err.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
