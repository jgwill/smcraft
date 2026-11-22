import { useEffect, useState } from "react";
import { readThreadItems, type CompanionReply } from "./companion.js";

/** Look up marked replies independently of the bounded Talk thread. */
export function useMarkedReplies(base: string, episode: string | null, mark: string | null, replyCount: number): CompanionReply[] {
  const address = episode && mark && replyCount
    ? `${base}replies?episode=${encodeURIComponent(episode)}&mark=${encodeURIComponent(mark)}`
    : null;
  const [loaded, setLoaded] = useState<{ address: string; replies: CompanionReply[] } | null>(null);
  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    fetch(address, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { replies?: unknown[] } | null) => {
        if (!data || controller.signal.aborted) return;
        const replies = readThreadItems(data.replies?.map((reply) => ({ ...(reply as object), kind: "reply" })))
          .filter((item): item is CompanionReply => item.kind === "reply");
        setLoaded({ address, replies });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [address, replyCount]);
  return loaded?.address === address ? loaded?.replies ?? [] : [];
}
