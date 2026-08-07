"use client";

import { useEffect, useState } from "react";

/**
 * The one client-side source of the requested document (chart steps 2/3/6 of
 * chart_1785683010290): the `?doc=` URL parameter. The browser only ever
 * PASSES the request through — resolution and the root allowlist live on the
 * server (lib/projectFile.ts), and the browser learns the resolved path from
 * the API response exactly as before. No parameter → the default document,
 * byte-identical to the old behavior.
 */

const DOC_CHANGE_EVENT = "stateloom:doc-change";

export function requestedDoc(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("doc");
}

/** Query-string tail for API calls: "?doc=…" or "". */
export function docQuery(doc: string | null): string {
  return doc ? `?doc=${encodeURIComponent(doc)}` : "";
}

/** Switch documents without a reload (step 6): rewrite the URL, tell the
 *  providers. History gets an entry so back/forward walk documents too. */
export function navigateToDoc(doc: string | null): void {
  const url = new URL(window.location.href);
  if (doc) url.searchParams.set("doc", doc);
  else url.searchParams.delete("doc");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new Event(DOC_CHANGE_EVENT));
}

/** The requested doc as reactive state: updates on picker navigation and on
 *  back/forward. Server render sees null; the first client effect corrects. */
export function useRequestedDoc(): string | null {
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setDoc(requestedDoc());
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(DOC_CHANGE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(DOC_CHANGE_EVENT, update);
    };
  }, []);
  return doc;
}
