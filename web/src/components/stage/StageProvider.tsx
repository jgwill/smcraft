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
 *
 * The caption's heading is the step's own title. When the step is about a
 * drawing that is not the one on the board (a page opened on another drawing
 * caught up with a tour the stage holds), the caption names that drawing,
 * offers "Open and play", and has no Answer: a mark would land on the wrong
 * drawing.
 *
 * On a phone (below 600 px) the bottom of the board holds one sheet: the Talk
 * dock's bar as its handle, then one of the caption, a mark's card (composer,
 * thread, list) or the Talk conversation. A card or the conversation takes the
 * caption's place while it is open, and the caption comes back when it closes.
 * Layers claim the sheet (`claimSheet`) and render into its slots
 * (`sheetHandle`, `sheetBody`); on a wider screen there is no sheet and each
 * keeps its own corner.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { browserDictation, browserVoice, useStage, type StageShown, type UseStage } from "@miadi/stateloom-react";
import { StageCaption, type ListenerLike } from "@miadi/stateloom-canvas";
import { DEFAULT_STAGE, isStageName, isSysdfPath, type Box, type MarksEnvelope, type StageContext } from "@miadi/stateloom-protocol";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { requestedDoc } from "@/lib/docParam";
import { FOCUS_REQUEST_EVENT, openInSystem, urlParam } from "@/lib/systemParam";
import { useNarrow } from "@/lib/useNarrow";
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

/** Who holds the phone's sheet in place of the caption: a mark's card, or the Talk conversation. */
export type SheetOwner = "card" | "talk";

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
  /** What is on stage now: a live step, or a tour's step with its place. */
  shown: StageShown | null;
  /** Play a tour from this page in its own voice — a companion's reply (Spec 84). */
  present: UseStage["present"];
  /** A companion answers behind `/api/companion` (Spec 84): the mark cards say who answers. */
  companion: boolean;
  pause: () => void;
  stop: () => void;
  /** The drawing on the board now (absolute), as its layer says; null on the system map. */
  board: string | null;
  setBoard: (doc: string | null) => void;
  /** Below 600 px: the caption, the cards and the conversation share one sheet. */
  narrow: boolean;
  /** Who holds the sheet instead of the caption. */
  sheet: SheetOwner | null;
  claimSheet: (owner: SheetOwner) => void;
  releaseSheet: (owner: SheetOwner) => void;
  /** The sheet's slots on a phone: the handle (the Talk bar), and the body (a card, the conversation). */
  sheetHandle: HTMLElement | null;
  sheetBody: HTMLElement | null;
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

/** The drawing's own name (settings.name), read once per drawing; its file name meanwhile. */
const drawingTitles = new Map<string, Promise<string | null>>();
function drawingTitle(doc: string): Promise<string | null> {
  let found = drawingTitles.get(doc);
  if (!found) {
    found = fetch(`/api/file?doc=${encodeURIComponent(doc)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { content?: string } | null) => {
        const def = data?.content ? JSON.parse(data.content) : null;
        const name = (def?.settings ?? def?.stateMachine?.settings)?.name;
        return typeof name === "string" && name ? name : null;
      })
      .catch(() => null);
    drawingTitles.set(doc, found);
  }
  return found;
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
  // The drawing on the board, and the one the stage just asked the page to open — asked
  // while `from` was on the board, so it counts only until the board changes.
  const [board, setBoardState] = useState<string | null>(null);
  const [opening, setOpeningState] = useState<{ doc: string; from: string | null } | null>(null);
  const boardNow = useRef<string | null>(null);
  const setOpening = useCallback((doc: string) => setOpeningState({ doc, from: boardNow.current }), []);
  const setBoard = useCallback((doc: string | null) => {
    boardNow.current = doc;
    setBoardState(doc);
  }, []);

  const show = useCallback((shown: StageShown | null) => {
    if (!shown) {
      setLit(null);
      return;
    }
    const { step } = shown;
    const open = requestedDoc();
    // A page opened on a drawing keeps it when it only catches up with what the stage held:
    // the caption says what waits, and ▶ opens it. A step sent now always opens its drawing.
    if (shown.caught && urlParam("doc")) {
      setLit({ doc: step.doc, focus: step.focus, spotlight: step.spotlight, region: step.region, nonce: shown.nonce });
      return;
    }
    if (step.doc && step.doc !== open) {
      setOpening(step.doc);
      openInSystem({ doc: step.doc, system: step.system ?? undefined, focus: step.focus ?? null });
    } else if (step.focus) {
      if (step.system && urlParam("system") !== step.system && open) openInSystem({ doc: open, system: step.system, focus: step.focus });
      else requestFocus(step.focus);
    }
    setLit({ doc: step.doc, focus: step.focus, spotlight: step.spotlight, region: step.region, nonce: shown.nonce });
  }, [setOpening]);

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

  // ── The phone's sheet ────────────────────────────────────────────────
  const narrow = useNarrow();
  const [sheet, setSheet] = useState<SheetOwner | null>(null);
  const claimSheet = useCallback((owner: SheetOwner) => setSheet(owner), []);
  const releaseSheet = useCallback((owner: SheetOwner) => setSheet((s) => (s === owner ? null : s)), []);
  const [sheetHandle, setSheetHandle] = useState<HTMLElement | null>(null);
  const [sheetBody, setSheetBody] = useState<HTMLElement | null>(null);

  // ── A step about a drawing that is not on the board ─────────────────
  const shownStep = stage.shown?.step ?? null;
  // Until the board's layer has said which drawing it shows, the page's `?doc=` stands for it.
  const asked = urlParam("doc");
  const onBoard = board ?? (asked && !isSysdfPath(asked) ? asked : null);
  const openingDoc = opening && opening.from === board ? opening.doc : null;
  const heldDoc = shownStep?.doc && shownStep.doc !== onBoard && shownStep.doc !== openingDoc ? shownStep.doc : null;
  const [heldTitle, setHeldTitle] = useState<{ doc: string; title: string | null } | null>(null);
  useEffect(() => {
    if (!heldDoc) return;
    let live = true;
    void drawingTitle(heldDoc).then((title) => live && setHeldTitle({ doc: heldDoc, title }));
    return () => {
      live = false;
    };
  }, [heldDoc]);
  const play = stage.play;
  const held = useMemo(() => {
    if (!heldDoc || !shownStep) return null;
    const title = heldTitle?.doc === heldDoc ? heldTitle.title : null;
    const drawing = title ?? (heldDoc.split("/").pop() ?? heldDoc).replace(/\.(smdf|erdf|sqdf|sysdf)\.json$/i, "").replace(/\.json$/i, "");
    const inTour = stage.shown?.index !== null && stage.shown?.index !== undefined;
    return {
      drawing,
      label: inTour ? "Open and play" : "Open the drawing",
      onOpen: () => {
        setOpening(heldDoc);
        openInSystem({ doc: heldDoc, system: shownStep.system ?? undefined, focus: shownStep.focus ?? null });
        if (inTour) play();
      },
    };
  }, [heldDoc, heldTitle, shownStep, stage.shown?.index, play, setOpening]);

  // How tall the caption stands, for what must sit above it beside the board (the Talk dock).
  const captionUp = !!stage.shown && !narrow;
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
      shown: stage.shown,
      present: stage.present,
      companion: config.companion,
      pause: stage.pause,
      stop: stage.stop,
      board,
      setBoard,
      narrow,
      sheet,
      claimSheet,
      releaseSheet,
      sheetHandle,
      sheetBody,
    }),
    [
      config.stage, config.companion, stage.status, stage.shown, stage.sendMarks, stage.present, stage.pause, stage.stop, lit, author, listener, answerNonce, report,
      board, setBoard, narrow, sheet, claimSheet, releaseSheet, sheetHandle, sheetBody,
    ],
  );

  const caption = stage.shown ? (
    <StageCaption
      shown={stage.shown}
      playing={stage.playing}
      speaking={stage.speaking}
      voice={stage.ownVoice ? undefined : voiceOn}
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
      held={held}
    />
  ) : null;

  return (
    <StageCtx.Provider value={value}>
      {children}
      {narrow ? (
        // One sheet at the bottom of the board: the handle, then the caption or what took its place.
        <div className="stage-sheet">
          <div className="stage-sheet-handle" ref={setSheetHandle} />
          <div className="stage-sheet-body" ref={setSheetBody} />
          {!sheet && caption && <div className="stage-sheet-caption">{caption}</div>}
        </div>
      ) : (
        caption && <div className="stage-caption-host">{caption}</div>
      )}
      {config.companion && <CompanionLayer stage={value} defaultEpisode={config.companionEpisode} />}
    </StageCtx.Provider>
  );
}
