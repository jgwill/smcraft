/**
 * What a person has read of a drawing's marks, kept in this browser (Spec 83).
 *
 * Per drawing, `stateloom.marks.read.v1:<doc>` holds mark id → the number of
 * replies the thread had when the person last opened it. With the protocol's
 * `unreadMarks(marks, read)` it says which threads carry an agent's word they
 * have not seen. Every access is guarded: a private window, blocked storage or
 * a server render reads as nothing read, and a write that fails is dropped.
 */
import { useCallback, useEffect, useState } from "react";
import { withMarkRead, type Mark, type MarksRead } from "@miadi/stateloom-protocol";

const PREFIX = "stateloom.marks.read.v1:";

export function marksReadKey(doc: string): string {
  return `${PREFIX}${doc}`;
}

export function loadMarksRead(doc: string): MarksRead {
  try {
    const raw = window.localStorage.getItem(marksReadKey(doc));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveMarksRead(doc: string, read: MarksRead): void {
  try {
    window.localStorage.setItem(marksReadKey(doc), JSON.stringify(read));
  } catch {
    // Storage refused (private mode, quota): the marks read again as new next time.
  }
}

/**
 * The read record of one drawing, and `markRead(mark)` to call when the person
 * opens a thread (and again while it stays open as replies arrive).
 */
export function useMarksRead(doc: string | null): { read: MarksRead; markRead: (mark: Pick<Mark, "id" | "replies">) => void } {
  const [state, setState] = useState<{ doc: string | null; read: MarksRead }>(() => ({ doc, read: doc ? loadMarksRead(doc) : {} }));
  useEffect(() => {
    setState((s) => (s.doc === doc ? s : { doc, read: doc ? loadMarksRead(doc) : {} }));
  }, [doc]);
  const markRead = useCallback(
    (mark: Pick<Mark, "id" | "replies">) => {
      if (!doc) return;
      setState((s) => {
        const base = s.doc === doc ? s.read : loadMarksRead(doc);
        if (base[mark.id] === (mark.replies?.length ?? 0) && s.doc === doc) return s;
        const read = withMarkRead(base, mark);
        saveMarksRead(doc, read);
        return { doc, read };
      });
    },
    [doc],
  );
  return { read: state.doc === doc ? state.read : {}, markRead };
}
