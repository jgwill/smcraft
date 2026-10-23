"use client";

import { useEffect, useState } from "react";

/**
 * A phone held upright: below 600 px the stage's caption, a mark's card and the Talk
 * conversation share one sheet at the bottom of the board (Spec 83, lane U finding U2).
 */
export const NARROW_QUERY = "(max-width: 599px)";

function matches(query: string): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function useNarrow(query = NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return narrow;
}
