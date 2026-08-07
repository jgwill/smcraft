"use client";

import { useState } from "react";
import { navigateToDoc, useRequestedDoc } from "@/lib/docParam";
import { rememberedDocs } from "@/lib/layoutMemory";

/**
 * A human switches diagrams without an agent and without a terminal
 * (chart_1785683062725). Presentation over state that already exists: recents
 * are the documents this browser holds layout memory for, plus a free path
 * field. Choosing navigates via `?doc=` — the providers re-key (step 3), the
 * server allowlist guards (step 1), no reload, no new transport.
 */
export default function DocSwitcher() {
  const requested = useRequestedDoc();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const go = (doc: string | null) => {
    setOpen(false);
    setTyped("");
    navigateToDoc(doc);
  };

  const recents = open
    ? rememberedDocs().filter((d) => d.startsWith("/") && d !== requested)
    : [];

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className="toolbar-btn"
        title={requested ? `Document: ${requested}` : "Switch document"}
      >
        ⇄
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded border border-gray-700 bg-gray-900 p-2 shadow-lg">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
            switch document
          </div>
          {requested && (
            <button
              onClick={() => go(null)}
              className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-gray-300 hover:bg-gray-800"
              title="Return to the default project file"
            >
              ⌂ default document
            </button>
          )}
          {recents.map((d) => (
            <button
              key={d}
              onClick={() => go(d)}
              className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-gray-300 hover:bg-gray-800"
              title={d}
            >
              {d.split("/").pop()}
              <span className="ml-1 text-[10px] text-gray-600">{d}</span>
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) go(typed.trim());
            }}
            className="mt-1 flex gap-1"
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="/absolute/path/to/doc.smdf.json"
              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-xs text-gray-200 placeholder:text-gray-600"
            />
            <button type="submit" className="toolbar-btn" title="Open this document">
              →
            </button>
          </form>
        </div>
      )}
    </span>
  );
}
