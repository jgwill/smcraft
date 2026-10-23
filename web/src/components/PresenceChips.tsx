"use client";

import { useState } from "react";
import { colorFor } from "@miadi/stateloom-protocol";
import { useDesignerStore } from "@/store/useDesignerStore";

/** Enough dots to read "several peers" at a glance; the count carries the rest. */
const MAX_DOTS = 4;

/**
 * Who else is on this board. It used to float over the top-right corner as one
 * pill per peer — which on a busy room meant a dozen chips painted across the
 * toolbar's own controls, hiding Validate/Generate/RISE behind a colour bar
 * nobody could dismiss. `pointer-events-none` kept the buttons clickable but
 * you could no longer see what you were clicking.
 *
 * So presence stops floating: it is a toolbar control like any other, laid out
 * in the flow beside the document identity it describes. Fixed width regardless
 * of how many peers join — a stack of colour dots and a count — with the full
 * roster one click away. Nothing can be covered by a room that grows.
 */
export default function PresenceChips() {
  const presence = useDesignerStore((s) => s.presence);
  const [open, setOpen] = useState(false);

  if (presence.length === 0) return null;

  const byRole = new Map<string, number>();
  for (const p of presence) byRole.set(p.role, (byRole.get(p.role) ?? 0) + 1);
  const summary = [...byRole]
    .map(([role, n]) => (n > 1 ? `${role} ×${n}` : role))
    .join(" · ");

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((v) => !v)}
        className="toolbar-btn inline-flex items-center gap-1.5"
        title={`Connected: ${summary}`}
        aria-expanded={open}
        aria-label={`${presence.length} connected: ${summary}`}
      >
        <span className="flex -space-x-1">
          {presence.slice(0, MAX_DOTS).map((p) => (
            <span
              key={p.clientId}
              className="inline-block h-2 w-2 rounded-full ring-1 ring-gray-900"
              style={{ backgroundColor: p.color ?? colorFor(p.clientId) }}
            />
          ))}
        </span>
        <span className="tabular-nums">{presence.length}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded border border-gray-700 bg-gray-900 p-2 shadow-lg">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
            connected · {summary}
          </div>
          {presence.map((p) => (
            <div
              key={p.clientId}
              className="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-gray-300"
              title={p.clientId}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.color ?? colorFor(p.clientId) }}
              />
              <span className="shrink-0">{p.role}</span>
              {p.name && <span className="truncate text-gray-500">{p.name}</span>}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
