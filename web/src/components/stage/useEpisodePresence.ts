"use client";

/**
 * Whether a Mia seat listens in the episode a drawing belongs to (Spec 83, Spec 84),
 * for the line the mark cards show under what a person writes and reads.
 *
 * Read from the companion's thread through this designer's proxy
 * (`/api/companion/thread?episode=`), the same presence the Talk dock shows: listening,
 * answering, answered, away. Polled every 10 s while a mark card is open and the page is
 * visible; what was last read is kept while the cards are closed, so a card opens with
 * its line. Null when there is no episode, before the first answer, and when the
 * companion does not answer.
 */
import { useEffect, useState } from "react";
import type { CompanionPresence } from "@miadi/stateloom-react";

export type PresenceState = CompanionPresence["state"];

const EVERY_MS = 10_000;

export function useEpisodePresence(episode: string | null, active: boolean): PresenceState | null {
  const [seen, setSeen] = useState<{ episode: string; state: PresenceState | null } | null>(null);

  useEffect(() => {
    if (!episode || !active) return;
    let live = true;
    const read = async (): Promise<void> => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/companion/thread?episode=${encodeURIComponent(episode)}`, { cache: "no-store" });
        const body = (await r.json()) as { success?: boolean; presence?: CompanionPresence | null };
        if (live) setSeen({ episode, state: body.success ? (body.presence?.state ?? null) : null });
      } catch {
        if (live) setSeen({ episode, state: null });
      }
    };
    void read();
    const t = setInterval(() => void read(), EVERY_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [episode, active]);

  return seen && seen.episode === episode ? seen.state : null;
}

/** "2026-10-19-episode-412-the-loom" → 412. */
export function episodeNumber(episode: string): number | null {
  const m = episode.match(/-episode-(\d+)-/);
  return m ? Number(m[1]) : null;
}

/** The line under the mark cards: who answers a mark left on a drawing of `episode`. */
export function presenceLine(state: PresenceState | null, episode: string | null): string | null {
  if (!state || !episode) return null;
  const n = episodeNumber(episode);
  const where = n === null ? "this episode" : `episode ${n}`;
  switch (state) {
    case "listening":
      return `Mia is listening in ${where}: she answers here`;
    case "answering":
      return "Mia is answering";
    case "answered":
      return `Mia has answered in ${where}: your mark waits until she listens again`;
    case "away":
      return `No seat is listening in ${where}: your mark waits until one does`;
    default:
      return null;
  }
}
