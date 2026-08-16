"use client";

import { useEffect, useState } from "react";
import { navigateToDoc, useRequestedDoc } from "@/lib/docParam";
import { rememberedDocs } from "@/lib/layoutMemory";

interface DocEntry {
  path: string;
  name: string;
  dir: string;
  mtime: number;
}

/**
 * A human switches diagrams without an agent and without a terminal
 * (chart_1785683062725). Choosing navigates via `?doc=` — the providers re-key
 * (step 3), the server allowlist guards (step 1), no reload, no new transport.
 *
 * The list comes from `GET /api/docs`, which enumerates exactly what that
 * allowlist admits. Before it existed this was a free-text field over this
 * browser's layout memory — empty on first use — so switching required knowing
 * the server's path for a directory you were looking at under a different name,
 * and typing it by hand every time. In a container that is `/data`, which is
 * not a thing anyone can guess. The field stays, for a path the walk did not
 * reach; it is no longer the only way in.
 */
export default function DocSwitcher() {
  const requested = useRequestedDoc();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  // What the SERVER currently has open. Not the same as `requested`: with no
  // `?doc=` the browser knows only "the default", and the default is a real
  // path that would otherwise be offered as somewhere to switch to.
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched on each open, not once: an agent creating a document while the
  // panel is shut is the normal case, and a stale list is the whole complaint.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    fetch("/api/docs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: { docs?: DocEntry[]; roots?: string[]; current?: string }) => {
        if (!live) return;
        setDocs(body.docs ?? []);
        setRoots(body.roots ?? []);
        setCurrent(body.current ?? null);
      })
      .catch((e: Error) => {
        if (!live) return;
        // An older server has no /api/docs. Recents and the field still work.
        setDocs([]);
        setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open]);

  const go = (doc: string | null) => {
    setOpen(false);
    setTyped("");
    navigateToDoc(doc);
  };

  // Layout memory still contributes: a document reached once and since deleted,
  // or one outside the walk's depth, is worth keeping in reach.
  const listed = new Set((docs ?? []).map((d) => d.path));
  const recents = open
    ? rememberedDocs().filter((d) => d.startsWith("/") && d !== requested && !listed.has(d))
    : [];

  const here = requested ?? current;
  const available = (docs ?? []).filter((d) => d.path !== here);
  const filter = typed.trim().toLowerCase();
  const shown = filter
    ? available.filter((d) => d.path.toLowerCase().includes(filter))
    : available;

  const rowClass =
    "block w-full truncate rounded px-1.5 py-1 text-left text-xs text-gray-300 hover:bg-gray-800";

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
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded border border-gray-700 bg-gray-900 p-2 shadow-lg">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
            switch document
          </div>

          {/* Doubles as filter and as free-text path — one field, because with a
              list present the typing is almost always narrowing, not addressing. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = typed.trim();
              if (!value) return;
              // A single match means the human already chose it by narrowing.
              if (shown.length === 1) return go(shown[0]!.path);
              if (value.startsWith("/")) return go(value);
            }}
            className="mb-1 flex gap-1"
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={docs === null ? "loading…" : "filter, or /absolute/path.json"}
              className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-xs text-gray-200 placeholder:text-gray-600"
            />
            <button type="submit" className="toolbar-btn" title="Open">
              →
            </button>
          </form>

          <div className="max-h-64 overflow-y-auto">
            {requested && (
              <button onClick={() => go(null)} className={rowClass} title="Return to the default project file">
                ⌂ default document
              </button>
            )}

            {shown.map((d) => (
              <button key={d.path} onClick={() => go(d.path)} className={rowClass} title={d.path}>
                {d.name}
                <span className="ml-1 text-[10px] text-gray-600">{d.dir}</span>
              </button>
            ))}

            {recents.length > 0 && (
              <div className="mt-1 border-t border-gray-800 pt-1">
                <div className="px-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-gray-600">
                  recent
                </div>
                {recents.map((d) => (
                  <button key={d} onClick={() => go(d)} className={rowClass} title={d}>
                    {d.split("/").pop()}
                    <span className="ml-1 text-[10px] text-gray-600">{d}</span>
                  </button>
                ))}
              </div>
            )}

            {docs !== null && shown.length === 0 && recents.length === 0 && (
              <div className="px-1.5 py-1 text-[11px] text-gray-500">
                {filter ? "nothing matches" : "no other documents here"}
              </div>
            )}
          </div>

          {/* The server's view of where documents live. In a container this is
              /data, and saying so is the difference between a refusal that
              reads as a bug and one that reads as an instruction. */}
          {roots.length > 0 && (
            <div className="mt-1 truncate border-t border-gray-800 pt-1 text-[10px] text-gray-600">
              paths are as the server sees them: {roots.join(", ")}
            </div>
          )}
          {error && (
            <div className="mt-1 text-[10px] text-gray-600">
              this server does not list documents ({error}) — type a path
            </div>
          )}
        </div>
      )}
    </span>
  );
}
