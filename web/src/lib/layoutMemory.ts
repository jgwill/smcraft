"use client";

/**
 * Browser-local memory of where the boxes sit.
 *
 * The board a designer builds by hand is not part of the SMDF — the document on
 * disk carries the machine, never the arrangement — so a reload used to throw
 * every drag away and re-derive the layout from scratch. This keeps the drags
 * in `localStorage`, keyed by the resolved project-file path, and hands them
 * back to the store on load so remembered boxes win over the derivation.
 *
 * What gets written is only what *deviates*: each position is compared against
 * what `autoLayout` derives for the current definition, and identical entries
 * are dropped. Three things follow from that one rule —
 *
 *   · a state nobody ever dragged keeps following the layout algorithm, so an
 *     improvement to `autoLayout` still reaches a returning user;
 *   · ⤢ Arrange writes nothing, because a derived board is reproduced exactly
 *     by re-deriving it;
 *   · a renamed or deleted state simply stops appearing in the derivation and
 *     is pruned on the next write — a stale name can never raise an error,
 *     because nothing ever looks it up.
 */

import { useEffect, useRef } from "react";
import { autoLayout as deriveLayout, normalizeViewport } from "@miadi/stateloom-react";
import type { Viewport } from "@miadi/stateloom-react";
import { useDesignerStore } from "@/store/useDesignerStore";
import type { StatePosition } from "@/types/definition";

const KEY_PREFIX = "stateloom.layout.v1:";
const WRITE_DEBOUNCE_MS = 300;

export interface LayoutMemory {
  positions: Record<string, StatePosition>;
  viewport: Viewport;
}

/** Documents this browser holds layout memory for — the picker's recents
 *  (chart_1785683062725: presentation over state that already exists). */
export function rememberedDocs(): string[] {
  try {
    const docs: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) docs.push(k.slice(KEY_PREFIX.length));
    }
    return docs.sort();
  } catch {
    return [];
  }
}

export function memoryKey(docId: string): string {
  return `${KEY_PREFIX}${docId}`;
}

function samePosition(a: StatePosition, b: StatePosition): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function isPosition(v: unknown): v is StatePosition {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.width) &&
    Number.isFinite(p.height)
  );
}

/**
 * The subset of `positions` worth remembering: entries that differ from what
 * the layout algorithm derives for this definition. Positions for names the
 * derivation doesn't know (deleted or renamed states) are dropped.
 */
export function pruneToDeviations(
  positions: Record<string, StatePosition>,
  derived: Record<string, StatePosition>
): Record<string, StatePosition> {
  const out: Record<string, StatePosition> = {};
  for (const [name, pos] of Object.entries(positions)) {
    const auto = derived[name];
    if (!auto) continue;
    if (!samePosition(pos, auto)) out[name] = pos;
  }
  return out;
}

/** Read this browser's memory for a document. Malformed data reads as nothing. */
export function readMemory(docId: string): LayoutMemory | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(memoryKey(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LayoutMemory> | null;
    const positions: Record<string, StatePosition> = {};
    for (const [name, pos] of Object.entries(parsed?.positions ?? {})) {
      if (isPosition(pos)) positions[name] = pos;
    }
    return { positions, viewport: normalizeViewport(parsed?.viewport) };
  } catch {
    return null;
  }
}

/** Write this browser's memory for a document. A full disk quota is not fatal. */
export function writeMemory(
  docId: string,
  positions: Record<string, StatePosition>,
  viewport: Viewport
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      memoryKey(docId),
      JSON.stringify({ positions, viewport, savedAt: Date.now() })
    );
  } catch {
    // Private mode, quota, disabled storage — the canvas keeps working without
    // memory rather than failing the render.
  }
}

/** The document this browser is remembering for: the resolved project path.
 *  The requested `?doc=` rides along (step 2) so memory keys follow the
 *  document the page actually asked for, not always the default. */
async function resolveDocId(): Promise<string> {
  try {
    const { requestedDoc, docQuery } = await import("./docParam");
    const r = await fetch(`/api/file${docQuery(requestedDoc())}`, { cache: "no-store" });
    if (r.ok) {
      const path = (await r.json())?.path;
      if (typeof path === "string" && path.length > 0) return path;
    }
  } catch {
    // Fall through to whatever the store knows.
  }
  return useDesignerStore.getState().fileName ?? "untitled";
}

/**
 * Mount once: restore the remembered board, then keep writing it back as the
 * layout and the viewport change.
 *
 * Restore and the document's own arrival race freely — either order lands the
 * same way, because both merges put stored boxes over derived ones.
 */
export function useLayoutMemory(): void {
  const hydrated = useRef(false);
  const docId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const id = await resolveDocId();
      if (cancelled) return;
      docId.current = id;
      const remembered = readMemory(id);
      if (remembered) {
        useDesignerStore
          .getState()
          .hydrateLayout(remembered.positions, remembered.viewport);
      }
      hydrated.current = true;
    })();

    const unsubscribe = useDesignerStore.subscribe((state, prev) => {
      if (!hydrated.current || !docId.current) return;
      if (state.layout === prev.layout && state.viewport === prev.viewport) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useDesignerStore.getState();
        writeMemory(
          docId.current!,
          pruneToDeviations(s.layout.positions, deriveLayout(s.definition)),
          s.viewport
        );
      }, WRITE_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
