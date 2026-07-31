"use client";

import { useEffect } from "react";
import {
  createBridgeSession,
  type BridgeSession,
} from "@miadi/stateloom-react";
import {
  diffDefinition,
  colorFor,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";
import { useDesignerStore } from "@/store/useDesignerStore";

const OUTBOUND_DEBOUNCE_MS = 60;

/**
 * Real-time bridge client (WS7a). Connects to the socket hub, applies inbound
 * live patches / full snapshots / presence into the designer store, and emits
 * the local edit stream back out as debounced PatchOp diffs. Disk persistence
 * stays the existing manual "💾 Disk" save — the hub does not write disk.
 *
 * Rendered only when NEXT_PUBLIC_STATELOOM_BRIDGE_URL (or the legacy
 * NEXT_PUBLIC_SMCRAFT_BRIDGE_URL twin) is set — see DesignBridge.
 */
export default function SocketBridgeProvider() {
  const presence = useDesignerStore((s) => s.presence);

  useEffect(() => {
    const url =
      process.env.NEXT_PUBLIC_STATELOOM_BRIDGE_URL ??
      process.env.NEXT_PUBLIC_SMCRAFT_BRIDGE_URL;
    if (!url) return;

    let cancelled = false;
    let session: BridgeSession | null = null;
    let unsub: (() => void) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    // The last definition we either received from the hub or sent to it — the
    // diff base so we never re-send ops that originated remotely.
    let lastSentDef: StateMachineDefinition | null = null;

    (async () => {
      // Learn the docId (the resolved project-file path) from the file API.
      let docId = "";
      try {
        const r = await fetch("/api/file", { cache: "no-store" });
        if (r.ok) docId = (await r.json())?.path ?? "";
      } catch {
        // Connect anyway; the hub keys the doc by whatever id we send.
      }
      if (cancelled) return;
      // The same path an export names its file after.
      if (docId) useDesignerStore.getState().setDocPath(docId);

      session = createBridgeSession({
        url,
        role: "web",
        docId,
        name: "web-designer",
        onFull: (e) => {
          useDesignerStore
            .getState()
            .applyRemote(
              JSON.stringify({ stateMachine: e.def }),
              e.mtime ?? Date.now()
            );
          lastSentDef = e.def;
        },
        onPatch: (e) => {
          useDesignerStore
            .getState()
            .applyRemoteOps(e.ops, e.mtime ?? Date.now(), e.seq);
          lastSentDef = useDesignerStore.getState().definition;
        },
        onPresence: (list) => {
          useDesignerStore.getState().setPresence(list);
        },
      });

      session.connect();

      // OUTBOUND: watch the definition; when the user (not a remote apply) edits,
      // debounce then emit the diff against the last known-synced definition.
      unsub = useDesignerStore.subscribe((state, prevStore) => {
        if (state.definition === prevStore.definition) return;
        if (state._applyingRemote) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!session || session.getSnapshot().status !== "connected") return;
          const cur = useDesignerStore.getState().definition;
          // No established base yet (fresh project, hub had no def): send a full
          // snapshot so the hub can seed its room, instead of a patch it cannot
          // apply onto nothing.
          if (lastSentDef === null) {
            session.emitFull(cur);
            lastSentDef = cur;
            return;
          }
          const ops = diffDefinition(lastSentDef, cur);
          if (ops.length === 0) return;
          session.emitPatch(ops);
          lastSentDef = cur;
        }, OUTBOUND_DEBOUNCE_MS);
      });
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (unsub) unsub();
      if (session) session.disconnect();
    };
  }, []);

  if (presence.length === 0) return null;

  return (
    // `presence-dock` replaces the raw `top-2 right-4`: with viewport-fit=cover
    // that corner can sit under a notch or the status bar, so the offset is
    // measured from the safe-area inset instead. Still pointer-events-none, so
    // it never competes with the toolbar it floats over.
    <div className="presence-dock flex gap-1 pointer-events-none">
      {presence.map((p) => (
        <span
          key={p.clientId}
          title={`${p.role}${p.name ? ` · ${p.name}` : ""}`}
          className="text-[10px] leading-none px-2 py-1 rounded-full text-white/95 shadow font-medium"
          style={{ backgroundColor: p.color ?? colorFor(p.clientId) }}
        >
          {p.role}
        </span>
      ))}
    </div>
  );
}
