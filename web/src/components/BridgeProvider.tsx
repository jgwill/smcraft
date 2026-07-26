"use client";

import { useEffect } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";

export default function BridgeProvider() {
  const applyRemote = useDesignerStore((s) => s.applyRemote);
  const setRemoteStatus = useDesignerStore((s) => s.setRemoteStatus);
  const setRemoteMtime = useDesignerStore((s) => s.setRemoteMtime);

  useEffect(() => {
    let cancelled = false;

    async function fetchFile(): Promise<{ content: string | null; mtime: number; path: string; exists: boolean } | null> {
      try {
        const r = await fetch("/api/file", { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    }

    (async () => {
      const data = await fetchFile();
      if (cancelled) return;
      if (data?.exists && data.content) {
        applyRemote(data.content, data.mtime, data.path.split("/").pop());
      } else {
        setRemoteStatus("idle", data ? `No file at ${data.path}` : null);
      }
    })();

    const es = new EventSource("/api/watch");

    es.addEventListener("hello", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (typeof data?.mtime === "number") setRemoteMtime(data.mtime);
      } catch {}
    });

    es.addEventListener("change", async (ev) => {
      let mtime = 0;
      try {
        mtime = JSON.parse((ev as MessageEvent).data)?.mtime ?? 0;
      } catch {}
      const known = useDesignerStore.getState().remoteMtime ?? 0;
      if (mtime <= known) return;
      const data = await fetchFile();
      if (!data?.exists || !data.content) return;
      const dirty = useDesignerStore.getState().dirty;
      if (dirty) {
        setRemoteStatus("remote-changed", `Disk changed at ${new Date(data.mtime).toLocaleTimeString()} — local has unsaved edits`);
        setRemoteMtime(data.mtime);
      } else {
        applyRemote(data.content, data.mtime, data.path.split("/").pop());
      }
    });

    es.addEventListener("error", () => {
      setRemoteStatus("error", "Watch stream disconnected");
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [applyRemote, setRemoteStatus, setRemoteMtime]);

  return null;
}
