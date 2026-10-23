/**
 * `useStage` — the React binding over `createStageSession` (Spec 83), shaped
 * like `useSmcraftBridge`: the session is made once, its snapshot read through
 * `useSyncExternalStore`, its calls stable across renders. `onShow` and
 * `onMarks` are read through a ref, so a host may pass fresh closures every
 * render without the session being rebuilt.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createStageSession,
  type StageSession,
  type StageSessionOptions,
  type StageSnapshot,
  type StageVoice,
} from "./stage.js";

export interface UseStageOptions extends Omit<StageSessionOptions, "client" | "setTimer" | "clearTimer" | "voice"> {
  /** The voice steps are heard in, or null to read them. May change between renders. */
  voice?: StageVoice | null;
  /** Connect on mount, disconnect on unmount. Default true. False also when there is no hub to reach. */
  enabled?: boolean;
}

export type UseStage = StageSnapshot & Omit<StageSession, "getSnapshot" | "subscribe" | "connect" | "disconnect" | "setVoice">;

export function useStage(opts: UseStageOptions): UseStage {
  const handlers = useRef({ onShow: opts.onShow, onMarks: opts.onMarks });
  handlers.current = { onShow: opts.onShow, onMarks: opts.onMarks };

  const sessionRef = useRef<StageSession | null>(null);
  const key = `${opts.url}\u0000${opts.stage ?? ""}\u0000${opts.token ?? ""}`;
  const keyRef = useRef(key);
  if (sessionRef.current === null || keyRef.current !== key) {
    keyRef.current = key;
    sessionRef.current = createStageSession({
      ...opts,
      voice: opts.voice ?? null,
      onShow: (shown) => handlers.current.onShow?.(shown),
      onMarks: (e) => handlers.current.onMarks?.(e),
    });
  }
  const session = sessionRef.current;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  const enabled = opts.enabled !== false && !!opts.url;
  useEffect(() => {
    if (!enabled) return;
    session.connect();
    return () => session.disconnect();
  }, [session, enabled]);

  const voice = opts.voice ?? null;
  useEffect(() => {
    session.setVoice(voice);
  }, [session, voice]);

  return {
    ...snapshot,
    play: session.play,
    pause: session.pause,
    next: session.next,
    prev: session.prev,
    goto: session.goto,
    stop: session.stop,
    dismiss: session.dismiss,
    sendContext: session.sendContext,
    sendMarks: session.sendMarks,
    present: session.present,
  };
}
