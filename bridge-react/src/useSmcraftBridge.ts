/**
 * `useSmcraftBridge` — a thin React binding over the framework-agnostic
 * `BridgeSession`. The session is created once (stable across renders via a
 * ref), its immutable snapshot is read through `useSyncExternalStore`, and the
 * imperative callbacks are memoised so a consumer's `useEffect`/`memo` deps
 * stay stable. All the real behaviour lives in `session.ts`; this file only
 * wires it into the React render/effect lifecycle.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  createBridgeSession,
  type BridgeSession,
} from "./session.js";
import type {
  BridgeClientOptions,
  BridgeStatus,
} from "@miadi/stateloom-client";
import type {
  StateMachineDefinition,
  PatchOp,
  Presence,
  PatchEnvelope,
  FullEnvelope,
} from "@miadi/stateloom-protocol";

export interface UseSmcraftBridgeOptions extends BridgeClientOptions {
  onFull?: (e: FullEnvelope) => void;
  onPatch?: (e: PatchEnvelope) => void;
  onPresence?: (p: Presence[]) => void;
  /** Connect (and join) on mount, disconnect on unmount. Default true. */
  autoConnect?: boolean;
}

export interface UseSmcraftBridge {
  status: BridgeStatus;
  def: StateMachineDefinition | null;
  seq: number;
  presence: Presence[];
  activeStates: string[];
  emitPatch: (ops: PatchOp[]) => void;
  emitFull: (def: StateMachineDefinition) => void;
  enter: (state: string, from?: string, eventId?: string) => void;
  exit: (state: string) => void;
  connect: () => void;
  disconnect: () => void;
}

export function useSmcraftBridge(opts: UseSmcraftBridgeOptions): UseSmcraftBridge {
  // Create the session exactly once; keep it stable across every render.
  const sessionRef = useRef<BridgeSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createBridgeSession(opts);
  }
  const session = sessionRef.current;

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );

  const autoConnect = opts.autoConnect !== false; // default true

  useEffect(() => {
    if (autoConnect) session.connect();
    return () => {
      session.disconnect();
    };
    // Session identity is stable; connect/disconnect run once per mount.
  }, [session, autoConnect]);

  const emitPatch = useCallback(
    (ops: PatchOp[]) => session.emitPatch(ops),
    [session],
  );
  const emitFull = useCallback(
    (def: StateMachineDefinition) => session.emitFull(def),
    [session],
  );
  const enter = useCallback(
    (state: string, from?: string, eventId?: string) => session.enter(state, from, eventId),
    [session],
  );
  const exit = useCallback(
    (state: string) => session.exit(state),
    [session],
  );
  const connect = useCallback(() => session.connect(), [session]);
  const disconnect = useCallback(() => session.disconnect(), [session]);

  return {
    status: snapshot.status,
    def: snapshot.def,
    seq: snapshot.seq,
    presence: snapshot.presence,
    activeStates: snapshot.activeStates,
    emitPatch,
    emitFull,
    enter,
    exit,
    connect,
    disconnect,
  };
}
