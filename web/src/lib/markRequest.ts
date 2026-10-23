"use client";

/**
 * "Open that mark": something outside the board (the Talk dock's list of marks) asks the
 * board showing `doc` to open the thread of mark `id`. The request waits here until that
 * board has read its marks — the drawing may still be opening — and is taken once.
 */
export const MARK_REQUEST_EVENT = "stateloom:mark-request";

let pending: { doc: string; id: string } | null = null;

export function requestMark(doc: string, id: string): void {
  pending = { doc, id };
  window.dispatchEvent(new Event(MARK_REQUEST_EVENT));
}

/** The mark asked for on `doc`, if any; it stays asked until `clearMarkRequest`. */
export function markRequested(doc: string | null): string | null {
  return doc && pending?.doc === doc ? pending.id : null;
}

export function clearMarkRequest(): void {
  pending = null;
}
