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
 * - `stateloom:system-found`: `system=` was written for the document already
 *   open (`useSystemOfDoc`); nothing else moved.
 */
import { useEffect, useState } from "react";
import { isSysdfPath } from "@miadi/stateloom-protocol";
import { DOC_CHANGE_EVENT } from "./docParam";

export const FOCUS_EVENT = "stateloom:focus";
export const FOCUS_REQUEST_EVENT = "stateloom:focus-request";
export const SYSTEM_CHANGED_EVENT = "stateloom:system-changed";
export const SYSTEM_FOUND_EVENT = "stateloom:system-found";
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
    const events = ["popstate", DOC_CHANGE_EVENT, FOCUS_EVENT, FOCUS_REQUEST_EVENT, SYSTEM_FOUND_EVENT];
    for (const e of events) window.addEventListener(e, update);
    return () => {
      for (const e of events) window.removeEventListener(e, update);
    };
  }, [name]);
  return value;
}

/**
 * Read the open drawing as a member of the system that lists it. A drawing
 * opened alone (`?doc=` and no `system=`, the link an agent prints) had no
 * strip, so nothing led back to the map or on to the other drawings. And a
 * drawing reached by the document switcher kept the strip of the system it was
 * left from, even when another system lists it.
 *
 * The server answers (`/api/system-of`, lib/systemOf.ts): the system already in
 * the URL when it lists the drawing, else the nearest one that does. When it
 * names another system, `system=` is rewritten in place, without a history
 * entry: the person did not move, the view learned where it is. When no system
 * lists the drawing, the URL is left as it is, and a strip already on screen
 * stays while the person browses.
 */
export function useSystemOfDoc(doc: string | null, system: string | null): void {
  useEffect(() => {
    if (!doc || isSysdfPath(doc)) return;
    let live = true;
    const query = new URLSearchParams({ doc });
    if (system) query.set("system", system);
    fetch(`/api/system-of?${query.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { system?: string | null } | null) => {
        const found = body?.system;
        if (!live || !found || found === system) return;
        // The person moved on while the server looked: this answer is for a view that is gone.
        if (urlParam("doc") !== doc || urlParam("system") !== system) return;
        const url = new URL(window.location.href);
        url.searchParams.set("system", found);
        window.history.replaceState(window.history.state, "", url);
        window.dispatchEvent(new Event(SYSTEM_FOUND_EVENT));
      })
      .catch(() => {
        // An older server has no /api/system-of: the drawing opens alone, as before.
      });
    return () => {
      live = false;
    };
  }, [doc, system]);
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
