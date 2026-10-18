"use client";

/**
 * The page's stage (Spec 83): one connection to the stage this designer
 * presents on, whichever workspace is open.
 *
 * It joins `?stage=` (else the server's `STATELOOM_STAGE`, else `default`) and
 * does what a shown step asks of the page as a whole: open the step's drawing
 * (inside its system, when it names one) and focus its element — the same
 * `openInSystem` an agent's `show` uses. What is lit inside the drawing — the
 * spotlight, the area — is handed to whichever `StageLayer` the open
 * workspace mounts, because only it knows where its elements are.
 *
 * It also holds what every layer shares: the caption and its controls, the
 * voice the person may turn on, the ears a mark may be spoken into, the name
 * marks are signed with, and the line back to the agents — what the person is
 * looking at, and that a drawing's marks changed.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { browserDictation, browserVoice, useStage, type StageShown, type UseStage } from "@miadi/stateloom-react";
import { StageCaption, type ListenerLike } from "@miadi/stateloom-canvas";
import { DEFAULT_STAGE, isStageName, type Box, type MarksEnvelope, type StageContext } from "@miadi/stateloom-protocol";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { requestedDoc } from "@/lib/docParam";
import { FOCUS_REQUEST_EVENT, openInSystem, urlParam } from "@/lib/systemParam";
import CompanionLayer from "./CompanionLayer";

/** What the step on stage lights inside its drawing. `doc` absent: whatever drawing is open. */
export interface Lit {
  doc?: string;
  focus?: string;
  spotlight?: string[];
  region?: Box;
  nonce: number;
}

/** What a layer reports about the board it sits on. */
export type BoardReport = Omit<StageContext, "stage" | "at" | "tour" | "who">;

export interface StageValue {
  stage: string;
  connected: boolean;
  lit: Lit | null;
  author: string;
  setAuthor: (name: string) => void;
  listener: ListenerLike | null;
  /** A layer asks to mark what is lit: moves when the person presses Answer on the caption. */
  answerNonce: number;
  report: (board: BoardReport) => void;
  lastReport: () => StageContext | null;
  sendMarks: (env: Omit<MarksEnvelope, "origin" | "stage">) => void;
  onMarks: (cb: (e: MarksEnvelope) => void) => () => void;
  /** Play a tour from this page in its own voice — a companion's reply (Spec 84). */
  present: UseStage["present"];
  pause: () => void;
  stop: () => void;
}

const StageCtx = createContext<StageValue | null>(null);

export function useStageContext(): StageValue | null {
  return useContext(StageCtx);
}

const VOICE_KEY = "stateloom.stage.voice";
const AUTHOR_KEY = "stateloom.author";

function readLocal(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice holds for this page only.
  }
}

/** Ask the open workspace to select and centre `focus` on the drawing already open. */
function requestFocus(focus: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("focus", focus);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(FOCUS_REQUEST_EVENT));
}

export default function StageProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<{ bridgeUrl: string | null; stage: string; companion: boolean; companionEpisode: string | null }>({
    bridgeUrl: null,
    stage: DEFAULT_STAGE,
    companion: false,
    companionEpisode: null,
  });
  useEffect(() => {
    let live = true;
    loadRuntimeConfig().then((c) => {
      if (!live) return;
      const asked = urlParam("stage");
      const stage = isStageName(asked) ? asked : isStageName(c.stage) ? c.stage : DEFAULT_STAGE;
      setConfig({ bridgeUrl: c.bridgeUrl, stage, companion: c.companion, companionEpisode: c.companionEpisode });
    });
    return () => {
      live = false;
    };
  }, []);

  // Read once from this browser. The provider mounts only after the page has
  // read its URL (never in the server's render), so there is nothing to hydrate.
  const [voiceOn, setVoiceOn] = useState(() => typeof window !== "undefined" && readLocal(VOICE_KEY) === "1");
  const [author, setAuthorState] = useState(() => (typeof window !== "undefined" ? readLocal(AUTHOR_KEY) : ""));
  const voice = useMemo(() => (voiceOn ? browserVoice() : null), [voiceOn]);
  const listener = useMemo<ListenerLike | null>(() => (typeof window === "undefined" ? null : browserDictation()), []);

  const [lit, setLit] = useState<Lit | null>(null);
  const marksListeners = useRef(new Set<(e: MarksEnvelope) => void>());

  const show = useCallback((shown: StageShown | null) => {
    if (!shown) {
      setLit(null);
      return;
    }
    const { step } = shown;
    const open = requestedDoc();
    if (step.doc && step.doc !== open) {
      openInSystem({ doc: step.doc, system: step.system ?? undefined, focus: step.focus ?? null });
    } else if (step.focus) {
      if (step.system && urlParam("system") !== step.system && open) openInSystem({ doc: open, system: step.system, focus: step.focus });
      else requestFocus(step.focus);
    }
    setLit({ doc: step.doc, focus: step.focus, spotlight: step.spotlight, region: step.region, nonce: shown.nonce });
  }, []);

  const stage = useStage({
    url: config.bridgeUrl ?? "",
    stage: config.stage,
    name: "web-stage",
    voice,
    enabled: !!config.bridgeUrl,
    onShow: show,
    onMarks: (e) => {
      for (const cb of [...marksListeners.current]) cb(e);
    },
  });

  // What the person is looking at, told to the agents a moment after it settles.
  const last = useRef<StageContext | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendContext = stage.sendContext;
  const report = useCallback(
    (board: BoardReport) => {
      const ctx: StageContext = { ...board, stage: config.stage, who: author || undefined, at: new Date().toISOString() };
      last.current = ctx;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => sendContext({ ...board, who: author || undefined }), 400);
    },
    [config.stage, author, sendContext],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // A tour moving is news too: say it again with the tour's place.
  useEffect(() => {
    if (last.current) sendContext({ ...last.current, who: author || undefined });
  }, [stage.index, stage.playing, stage.tour, sendContext, author]);

  const [answerNonce, setAnswerNonce] = useState(0);

  // How tall the caption stands, for what must sit above it on a phone (the Talk dock).
  const captionUp = !!stage.shown;
  useEffect(() => {
    const root = document.documentElement;
    const caption = captionUp ? document.querySelector<HTMLElement>(".stage-caption-host .slc-stage-caption") : null;
    if (!caption || typeof ResizeObserver === "undefined") {
      root.style.removeProperty("--stage-caption-h");
      return;
    }
    const measure = () => root.style.setProperty("--stage-caption-h", `${Math.ceil(caption.getBoundingClientRect().height) + 12}px`);
    const watch = new ResizeObserver(measure);
    watch.observe(caption);
    measure();
    return () => {
      watch.disconnect();
      root.style.removeProperty("--stage-caption-h");
    };
  }, [captionUp]);

  const value = useMemo<StageValue>(
    () => ({
      stage: config.stage,
      connected: stage.status === "connected",
      lit,
      author,
      setAuthor: (name: string) => {
        setAuthorState(name);
        writeLocal(AUTHOR_KEY, name);
      },
      listener,
      answerNonce,
      report,
      lastReport: () => last.current,
      sendMarks: stage.sendMarks,
      onMarks: (cb) => {
        marksListeners.current.add(cb);
        return () => {
          marksListeners.current.delete(cb);
        };
      },
      present: stage.present,
      pause: stage.pause,
      stop: stage.stop,
    }),
    [config.stage, stage.status, stage.sendMarks, stage.present, stage.pause, stage.stop, lit, author, listener, answerNonce, report],
  );

  return (
    <StageCtx.Provider value={value}>
      {children}
      {stage.shown && (
        <div className="stage-caption-host">
          <StageCaption
            shown={stage.shown}
            playing={stage.playing}
            speaking={stage.speaking}
            voice={voiceOn}
            onToggleVoice={() => {
              const next = !voiceOn;
              setVoiceOn(next);
              writeLocal(VOICE_KEY, next ? "1" : "0");
            }}
            onPlay={stage.play}
            onPause={stage.pause}
            onNext={stage.next}
            onPrev={stage.prev}
            onGoto={stage.goto}
            onClose={stage.dismiss}
            onAnswer={() => setAnswerNonce((n) => n + 1)}
          />
        </div>
      )}
      {config.companion && <CompanionLayer stage={value} defaultEpisode={config.companionEpisode} />}
    </StageCtx.Provider>
  );
}
