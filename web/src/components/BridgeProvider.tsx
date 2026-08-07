"use client";

import { useEffect } from "react";
import { useDesignerStore } from "@/store/useDesignerStore";
import { docQuery, useRequestedDoc } from "@/lib/docParam";

export default function BridgeProvider() {
  const applyRemote = useDesignerStore((s) => s.applyRemote);
  const setRemoteStatus = useDesignerStore((s) => s.setRemoteStatus);
  const setRemoteMtime = useDesignerStore((s) => s.setRemoteMtime);
  // Step 2: the requested `?doc=` rides both the file fetch and the watch
  // stream; the server resolves and guards, the browser only passes through.
  const requested = useRequestedDoc();

  useEffect(() => {
    let cancelled = false;
    const qs = docQuery(requested);

    async function fetchFile(): Promise<{ content: string | null; mtime: number; path: string; exists: boolean } | null> {
      try {
        const r = await fetch(`/api/file${qs}`, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    }

    (async () => {
      const data = await fetchFile();
      if (cancelled) return;
      // The whole path, not just the basename: an export reads the episode off it.
      if (data?.path) useDesignerStore.getState().setDocPath(data.path);
      if (data?.exists && data.content) {
        applyRemote(data.content, data.mtime, data.path.split("/").pop());
      } else {
        setRemoteStatus("idle", data ? `No file at ${data.path}` : null);
      }
    })();

    const es = new EventSource(`/api/watch${qs}`);

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
    // `requested` re-keys the whole effect (step 3): a document switch closes
    // the old watch stream and loads + watches the new document, no reload.
  }, [applyRemote, setRemoteStatus, setRemoteMtime, requested]);

  return null;
}
