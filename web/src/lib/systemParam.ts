"use client";

/**
 * The view of a system, kept in the URL (Spec 82): `?doc=<member>` is what is
 * open, `system=<.sysdf.json>` says which system it is read as a member of, and
 * `focus=<kind>:<name>` is the element in hand. None of it is ever written into
 * a document — a view belongs to the browser that is looking.
 *
 * Four window events tie the pieces together without a shared store:
 *
 * - `stateloom:doc-change` (docParam.ts): the open document changed.
 * - `stateloom:focus-request`: something outside the workspace (the strip, an
 *   agent's `view:show`) asks the open workspace to select and centre `focus`.
 * - `stateloom:focus`: the workspace wrote the element the person selected, so
 *   the strip can list its links.
 * - `stateloom:system-changed`: a member or the system file was written; every
 *   holder of a loaded system reloads it.
 */
import { useEffect, useState } from "react";
import { DOC_CHANGE_EVENT } from "./docParam";

export const FOCUS_EVENT = "stateloom:focus";
export const FOCUS_REQUEST_EVENT = "stateloom:focus-request";
export const SYSTEM_CHANGED_EVENT = "stateloom:system-changed";
/** A one-line note for the system strip: `{ detail: { text, origin? } }`. */
export const STRIP_NOTE_EVENT = "stateloom:strip-note";

export function urlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** A URL parameter as reactive state, following every way this app changes it. */
export function useUrlParam(name: string): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setValue(urlParam(name));
    update();
    const events = ["popstate", DOC_CHANGE_EVENT, FOCUS_EVENT, FOCUS_REQUEST_EVENT];
    for (const e of events) window.addEventListener(e, update);
    return () => {
      for (const e of events) window.removeEventListener(e, update);
    };
  }, [name]);
  return value;
}

/** The query string for a member opened inside a system, focused on one element. */
export function systemQuery(target: { doc: string; system?: string | null; focus?: string | null }): string {
  const params = new URLSearchParams();
  params.set("doc", target.doc);
  if (target.system) params.set("system", target.system);
  if (target.focus) params.set("focus", target.focus);
  return `?${params.toString()}`;
}

/**
 * Open `doc` (inside `system`, when given; the current one otherwise) and ask
 * whichever workspace shows it to focus `focus`. A new document is a history
 * entry, so back walks it; a new focus on the same document is not.
 */
export function openInSystem(target: { doc: string; system?: string | null; focus?: string | null }): void {
  const url = new URL(window.location.href);
  const docChanged = url.searchParams.get("doc") !== target.doc;
  url.searchParams.set("doc", target.doc);
  const system = target.system === undefined ? url.searchParams.get("system") : target.system;
  if (system) url.searchParams.set("system", system);
  else url.searchParams.delete("system");
  if (target.focus) url.searchParams.set("focus", target.focus);
  else url.searchParams.delete("focus");
  if (docChanged) window.history.pushState({}, "", url);
  else window.history.replaceState(window.history.state, "", url);
  if (docChanged) window.dispatchEvent(new Event(DOC_CHANGE_EVENT));
  window.dispatchEvent(new Event(FOCUS_REQUEST_EVENT));
}

/** Record the element a person selected, without a history entry. */
export function writeFocus(focus: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if ((url.searchParams.get("focus") ?? null) === focus) return;
  if (focus) url.searchParams.set("focus", focus);
  else url.searchParams.delete("focus");
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
}

/**
 * The focus a workspace is asked to show, with a counter that moves on every
 * request — on mount, on back/forward, on a document change and on an explicit
 * request — so the same focus asked twice is shown twice.
 */
export function useFocusRequest(): { focus: string | null; nonce: number } {
  const [request, setRequest] = useState<{ focus: string | null; nonce: number }>({ focus: null, nonce: 0 });
  useEffect(() => {
    const bump = () => setRequest((r) => ({ focus: urlParam("focus"), nonce: r.nonce + 1 }));
    bump();
    const events = ["popstate", DOC_CHANGE_EVENT, FOCUS_REQUEST_EVENT];
    for (const e of events) window.addEventListener(e, bump);
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, []);
  return request;
}

/** Say one short line in the system strip. */
export function stripNote(text: string, origin?: string): void {
  window.dispatchEvent(new CustomEvent(STRIP_NOTE_EVENT, { detail: { text, origin } }));
}
