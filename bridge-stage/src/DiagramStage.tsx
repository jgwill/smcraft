"use client";

/**
 * The stage: drawings an agent walks a person through, and a person points at.
 *
 * Three things move what is lit on the board, and the newest wins:
 * - a **tour** step (`*.tour.json`) the person plays, steps through or pauses;
 * - a **cue** from outside — an agent's live `view:show`, a reply that names
 *   a drawing — honoured once per `seq`;
 * - a **mark** the person opens again from the list.
 *
 * Tapping elements picks them (the board lights what is picked, the tour
 * pauses). The person then says what they see — typed, or dictated where the
 * browser listens — and the stage hands the host a `MarkDraft`. Where the
 * draft goes (a `marks.jsonl` beside the drawings, a hub, a chat) is the
 * host's business; the stage never writes anything.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  EntityRelationshipCanvas,
  SequenceCanvas,
  StateMachineCanvas,
  type CanvasTheme,
} from "@miadi/stateloom-canvas";
import {
  DEFAULT_HOLD_MS,
  IDENTITY_VIEWPORT,
  autoLayout,
  erdAutoLayout,
  erdFrame,
  fitToBoxes,
  machineFrame,
  sequenceFrame,
  sequenceLayout,
  stepSpeech,
  type Box,
  type LayoutBox,
  type MarkDraft,
  type MarkKind,
  type SequenceLayout,
  type StageMark,
  type StageTour,
  type Viewport,
} from "@miadi/stateloom-protocol";
import { moveCamera } from "./camera.js";
import { loadDrawing, type LoadedDrawing, type StageDrawing } from "./drawing.js";
import { browserSpeaker, canListen, listen, type Listening } from "./speech.js";

/** Something outside the stage asking it to show a drawing, lit. */
export interface StageCue {
  member?: string;
  focus?: string[];
  /** What the caption says while the cue holds. */
  text?: string;
  /** Who asked (`mia`, `agent`). */
  from?: string;
  /** A new number is a new cue; the same number is not shown twice. */
  seq: number;
}

/** What the stage is showing, for a host that keeps it in its address. */
export interface StageShowing {
  member: string;
  step: number | null;
  focus: string[];
}

export interface DiagramStageProps {
  drawings: StageDrawing[];
  tour?: StageTour | null;
  /** The tour's path, carried into marks made while it plays. */
  tourPath?: string;
  marks?: StageMark[];
  cue?: StageCue | null;
  /** A person sent a mark. Resolve to clear the draft, reject to keep it. */
  onMark?: (draft: MarkDraft) => Promise<void> | void;
  /** Who is marking (`william`). */
  person?: string;
  /** Read captions aloud with the browser's voice. Default true. */
  voice?: boolean;
  /** BCP 47 language for the voice and for dictation. Default `en-US`. */
  lang?: string;
  initialMember?: string;
  initialStep?: number;
  onShow?: (showing: StageShowing) => void;
  /** Height of the board. Default `min(62vh, 560px)`. */
  boardHeight?: number | string;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

const KIND_LABELS: Record<MarkKind, string> = {
  question: "Question",
  concern: "Concern",
  change: "Change this",
  agree: "Looks right",
  note: "Note",
};

const KIND_GLYPH: Record<MarkKind, string> = {
  question: "?",
  concern: "!",
  change: "✎",
  agree: "✓",
  note: "•",
};

const MARK_ORDER: MarkKind[] = ["question", "concern", "change", "agree", "note"];

interface Pointer {
  member: string;
  focus: string[];
  text?: string;
  from: "tour" | "cue" | "mark";
  who?: string;
}

type Layout =
  | { kind: "machine"; positions: Record<string, LayoutBox> }
  | { kind: "erd"; positions: Record<string, LayoutBox> }
  | { kind: "sequence"; layout: SequenceLayout };

function layoutOf(d: LoadedDrawing): Layout {
  if (d.kind === "machine") return { kind: "machine", positions: autoLayout(d.def) };
  if (d.kind === "erd") return { kind: "erd", positions: erdAutoLayout(d.def, { notation: "crowsfoot" }) };
  return { kind: "sequence", layout: sequenceLayout(d.def) };
}

function frameOf(d: LoadedDrawing, layout: Layout, focus: readonly string[]): { boxes: Box[]; focused: boolean; path?: string[] } {
  if (d.kind === "machine" && layout.kind === "machine") return machineFrame(d.def, layout.positions, focus);
  if (layout.kind === "erd") return erdFrame(layout.positions, focus);
  if (layout.kind === "sequence") return sequenceFrame(layout.layout, focus);
  return { boxes: [], focused: false };
}

function holdFor(text: string, holdMs?: number): number {
  if (holdMs) return holdMs;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(DEFAULT_HOLD_MS, words * 330);
}

export function DiagramStage({
  drawings,
  tour = null,
  tourPath,
  marks = [],
  cue = null,
  onMark,
  person,
  voice = true,
  lang = "en-US",
  initialMember,
  initialStep,
  onShow,
  boardHeight = "min(62vh, 560px)",
  theme,
  className,
  style,
}: DiagramStageProps) {
  const loaded = useMemo(() => drawings.map((d) => ({ path: d.path, ...loadDrawing(d) })), [drawings]);
  const usable = useMemo(() => loaded.flatMap((l) => (l.drawing ? [l.drawing] : [])), [loaded]);
  const layouts = useMemo(() => new Map(usable.map((d) => [d.path, layoutOf(d)])), [usable]);
  const speaker = useMemo(() => browserSpeaker(), []);

  const firstMember = initialMember ?? tour?.steps[initialStep ?? 0]?.member ?? usable[0]?.path ?? "";
  const [member, setMember] = useState(firstMember);
  const [step, setStep] = useState<number | null>(tour ? Math.min(initialStep ?? 0, tour.steps.length - 1) : null);
  const [pointer, setPointer] = useState<Pointer | null>(() => {
    const s = tour?.steps[initialStep ?? 0];
    return s?.member ? { member: s.member, focus: s.focus ?? [], text: s.text, from: "tour" } : null;
  });
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(voice && speaker.available);
  const [picked, setPicked] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [draftKind, setDraftKind] = useState<MarkKind>("question");
  const [draftNote, setDraftNote] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [showMarks, setShowMarks] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [smPath, setSmPath] = useState<string[]>([]);

  const boardRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cancelCamera = useRef<() => void>(() => {});
  const listening = useRef<Listening | null>(null);
  const lastCue = useRef<number | null>(null);
  const playToken = useRef(0);

  const drawing = usable.find((d) => d.path === member) ?? usable[0] ?? null;
  const layout = drawing ? layouts.get(drawing.path) ?? null : null;
  const lit = picked.length > 0 ? picked : pointer && drawing && pointer.member === drawing.path ? pointer.focus : [];
  const openMarks = marks.filter((m) => m.status !== "resolved").length;

  // The board's size, which every fit is computed against.
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const aim = useCallback(
    (d: LoadedDrawing | null, focus: readonly string[], animate = true) => {
      if (!d || size.width === 0) return;
      const l = layouts.get(d.path);
      if (!l) return;
      const frame = frameOf(d, l, focus);
      if (frame.path) setSmPath(frame.path);
      const target = fitToBoxes(frame.boxes, size.width, size.height, {
        padding: frame.focused ? 64 : 32,
        maxScale: frame.focused ? 1.5 : 1,
      });
      cancelCamera.current();
      cancelCamera.current = animate ? moveCamera(viewportRef.current, target, setViewport) : (setViewport(target), () => {});
    },
    [layouts, size.width, size.height],
  );

  // Point the camera whenever what is shown changes, or the board is resized.
  const pointerKey = pointer ? `${pointer.member}|${pointer.focus.join(",")}` : "";
  useEffect(() => {
    if (!drawing) return;
    const focus = pointer && pointer.member === drawing.path ? pointer.focus : [];
    aim(drawing, focus, viewportRef.current !== IDENTITY_VIEWPORT);
    // `aim` changes with the size; the pointer and the drawing are the rest.
  }, [aim, drawing, pointerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelCamera.current(), []);

  /** A person drilled in or out: frame the level they are now looking at. */
  const drill = useCallback(
    (path: string[]) => {
      setSmPath(path);
      if (!drawing || drawing.kind !== "machine" || layout?.kind !== "machine" || size.width === 0) return;
      let level = drawing.def.state;
      for (const name of path) {
        const next = (level.parallel?.states ?? level.states ?? []).find((c) => c.name === name);
        if (!next) break;
        level = next;
      }
      const boxes = (level.parallel?.states ?? level.states ?? []).map((c) => layout.positions[c.name]).filter(Boolean);
      cancelCamera.current();
      cancelCamera.current = moveCamera(viewportRef.current, fitToBoxes(boxes, size.width, size.height, { padding: 32 }), setViewport);
    },
    [drawing, layout, size.width, size.height],
  );

  useEffect(() => {
    onShow?.({ member: drawing?.path ?? "", step, focus: lit });
  }, [drawing?.path, step, lit.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = useCallback(
    (text: string) => (voiceOn && speaker.available ? speaker.speak(text, { lang }) : Promise.resolve()),
    [voiceOn, speaker, lang],
  );

  const goTo = useCallback(
    (index: number, speakIt: boolean) => {
      if (!tour) return;
      const i = Math.max(0, Math.min(tour.steps.length - 1, index));
      const s = tour.steps[i];
      setStep(i);
      setPicked([]);
      if (s.member) setMember(s.member);
      setPointer({ member: s.member ?? member, focus: s.focus ?? [], text: s.text, from: "tour", who: tour.by });
      if (speakIt) void say(stepSpeech(s));
    },
    [tour, member, say],
  );

  // Playing: say the step (or hold it), then the next, until the last.
  useEffect(() => {
    if (!playing || !tour || step === null) return;
    const token = ++playToken.current;
    const s = tour.steps[step];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => {
      if (token !== playToken.current) return;
      if (step >= tour.steps.length - 1) setPlaying(false);
      else goTo(step + 1, false);
    };
    if (voiceOn && speaker.available) {
      void speaker.speak(stepSpeech(s), { lang }).then(() => {
        timer = setTimeout(advance, 700);
      });
    } else {
      timer = setTimeout(advance, holdFor(s.text, s.holdMs));
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [playing, step, tour, voiceOn, speaker, lang, goTo]);

  const stop = useCallback(() => {
    playToken.current += 1;
    setPlaying(false);
    speaker.cancel();
  }, [speaker]);

  // A cue is shown once per seq, and stops a tour that was playing.
  useEffect(() => {
    if (!cue || cue.seq === lastCue.current) return;
    lastCue.current = cue.seq;
    stop();
    const target = cue.member && usable.some((d) => d.path === cue.member) ? cue.member : member;
    setMember(target);
    setPicked([]);
    setPointer({ member: target, focus: cue.focus ?? [], text: cue.text, from: "cue", who: cue.from });
    if (cue.text) void say(cue.text);
  }, [cue, usable, member, stop, say]);

  const pick = useCallback(
    (focus: string) => {
      stop();
      setNotice(null);
      setPicked((p) => (p.includes(focus) ? p.filter((f) => f !== focus) : [...p, focus]));
    },
    [stop],
  );

  const openDrawing = (path: string) => {
    stop();
    setPicked([]);
    setComposing(false);
    setMember(path);
    setPointer(null);
  };

  const openMark = (m: StageMark) => {
    stop();
    setPicked([]);
    setMember(m.member);
    setPointer({ member: m.member, focus: m.focus, text: m.note, from: "mark", who: m.by });
  };

  const startDictation = () => {
    if (dictating) {
      listening.current?.stop();
      return;
    }
    const before = draftNote ? `${draftNote.trim()} ` : "";
    const session = listen(
      (text) => setDraftNote(before + text),
      (error) => {
        setDictating(false);
        listening.current = null;
        if (error && error !== "no-speech" && error !== "aborted") setNotice(`Dictation stopped: ${error}`);
      },
      lang,
    );
    if (session) {
      speaker.cancel();
      listening.current = session;
      setDictating(true);
    }
  };

  const send = async () => {
    if (!onMark || !drawing) return;
    listening.current?.stop();
    setSending(true);
    setNotice(null);
    try {
      await onMark({
        member: drawing.path,
        focus: picked,
        kind: draftKind,
        note: draftNote.trim(),
        by: person,
        tour: pointer?.from === "tour" ? tourPath : undefined,
        step: pointer?.from === "tour" && step !== null ? step : undefined,
      });
      setPicked([]);
      setDraftNote("");
      setComposing(false);
      setNotice("Sent. It is in the agent's context for the next turn.");
    } catch (error) {
      setNotice(`Not sent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!tour || step === null || composing) return;
    if (e.key === "ArrowRight") (stop(), goTo(step + 1, voiceOn));
    else if (e.key === "ArrowLeft") (stop(), goTo(step - 1, voiceOn));
    else if (e.key === " ") {
      e.preventDefault();
      playing ? stop() : setPlaying(true);
    }
  };

  const failed = loaded.filter((l) => !l.drawing);
  const current = tour && step !== null ? tour.steps[step] : null;
  const caption = pointer && drawing && pointer.member === drawing.path ? pointer : null;

  return (
    <div
      className={`sls-stage${className ? ` ${className}` : ""}`}
      style={style}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={tour ? `Tour: ${tour.title}` : "Drawings"}
    >
      <div className="sls-tabs" role="tablist">
        {usable.map((d) => {
          const count = marks.filter((m) => m.member === d.path && m.status !== "resolved").length;
          return (
            <button
              key={d.path}
              type="button"
              role="tab"
              aria-selected={d.path === drawing?.path}
              className={`sls-tab${d.path === drawing?.path ? " sls-tab--on" : ""}`}
              onClick={() => openDrawing(d.path)}
            >
              <span className={`sls-kind sls-kind--${d.kind}`}>{d.kind === "machine" ? "SM" : d.kind === "erd" ? "ERD" : "SEQ"}</span>
              {d.label}
              {count > 0 && <span className="sls-count">{count}</span>}
            </button>
          );
        })}
        {marks.length > 0 && (
          <button type="button" className="sls-tab sls-tab--marks" onClick={() => setShowMarks((v) => !v)} aria-expanded={showMarks}>
            Marks <span className="sls-count">{openMarks}</span>
          </button>
        )}
      </div>

      <div className="sls-board" ref={boardRef} style={{ height: boardHeight }}>
        {!drawing ? (
          <div className="sls-empty">{failed[0]?.reason ? `${failed[0].path}: ${failed[0].reason}` : "No drawing to show."}</div>
        ) : drawing.kind === "machine" && layout?.kind === "machine" ? (
          <StateMachineCanvas
            definition={drawing.def}
            positions={layout.positions}
            path={smPath}
            viewport={viewport}
            onViewportChange={setViewport}
            readOnly
            spotlight={lit}
            onSelect={(kind, id) => pick(`${kind}:${id}`)}
            onNavigateInto={(name) => drill([...smPath, name])}
            onNavigateTo={(depth) => drill(smPath.slice(0, depth))}
            theme={theme}
          />
        ) : drawing.kind === "erd" && layout?.kind === "erd" ? (
          <EntityRelationshipCanvas
            definition={drawing.def}
            positions={layout.positions}
            viewport={viewport}
            onViewportChange={setViewport}
            readOnly
            spotlight={lit}
            onSelect={(entity) => pick(`entity:${entity}`)}
            theme={theme}
          />
        ) : drawing.kind === "sequence" && layout?.kind === "sequence" ? (
          <SequenceCanvas
            definition={drawing.def}
            layout={layout.layout}
            viewport={viewport}
            onViewportChange={setViewport}
            spotlight={lit}
            onSelect={(kind, id) => pick(`${kind}:${id}`)}
            theme={theme}
          />
        ) : null}
        {caption?.from === "cue" && <div className="sls-badge">{caption.who ?? "agent"} is showing this</div>}
      </div>

      {picked.length > 0 ? (
        <div className="sls-panel sls-panel--pick">
          <div className="sls-picked">
            {picked.map((f) => (
              <button key={f} type="button" className="sls-chip" onClick={() => pick(f)} title="Unpick">
                {f} ×
              </button>
            ))}
          </div>
          {composing ? (
            <div className="sls-compose">
              <div className="sls-kinds" role="radiogroup" aria-label="What kind of mark">
                {MARK_ORDER.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={draftKind === k}
                    className={`sls-kindchip${draftKind === k ? " sls-kindchip--on" : ""}`}
                    onClick={() => setDraftKind(k)}
                  >
                    {KIND_GLYPH[k]} {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
              <textarea
                className="sls-note"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="What do you see here? The agent reads this with what you picked."
                rows={3}
              />
              <div className="sls-row">
                {canListen() && (
                  <button type="button" className={`sls-btn${dictating ? " sls-btn--live" : ""}`} onClick={startDictation}>
                    {dictating ? "■ Stop" : "🎙 Say it"}
                  </button>
                )}
                <span className="sls-grow" />
                <button type="button" className="sls-btn" onClick={() => setComposing(false)} disabled={sending}>
                  Back
                </button>
                <button
                  type="button"
                  className="sls-btn sls-btn--primary"
                  onClick={send}
                  disabled={sending || !onMark || (!draftNote.trim() && picked.length === 0)}
                >
                  {sending ? "Sending…" : "Send mark"}
                </button>
              </div>
            </div>
          ) : (
            <div className="sls-row">
              <span className="sls-hint">
                {picked.length} picked{current ? ` · step ${step! + 1} paused` : ""}
              </span>
              <span className="sls-grow" />
              <button type="button" className="sls-btn" onClick={() => setPicked([])}>
                Clear
              </button>
              {onMark && (
                <button type="button" className="sls-btn sls-btn--primary" onClick={() => setComposing(true)}>
                  Mark…
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="sls-panel">
          {current && tour ? (
            <>
              <div className="sls-caption-head">
                <span className="sls-step">
                  {step! + 1}/{tour.steps.length}
                </span>
                <span className="sls-title">{current.title ?? tour.title}</span>
                {tour.by && <span className="sls-by">{tour.by}</span>}
              </div>
              {caption?.from !== "tour" && caption?.text ? (
                <p className="sls-text sls-text--cue">{caption.text}</p>
              ) : (
                <p className="sls-text">{current.text}</p>
              )}
              <div className="sls-row">
                <button type="button" className="sls-btn" onClick={() => (stop(), goTo(step! - 1, voiceOn))} disabled={step === 0} aria-label="Previous step">
                  ◀
                </button>
                <button
                  type="button"
                  className="sls-btn sls-btn--primary"
                  onClick={() => {
                    if (playing) return stop();
                    goTo(step === tour.steps.length - 1 ? 0 : step!, false);
                    setPlaying(true);
                  }}
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? "❚❚ Pause" : step === tour.steps.length - 1 && !playing ? "▶ Play again" : "▶ Play"}
                </button>
                <button
                  type="button"
                  className="sls-btn"
                  onClick={() => (stop(), goTo(step! + 1, voiceOn))}
                  disabled={step === tour.steps.length - 1}
                  aria-label="Next step"
                >
                  ▶
                </button>
                <span className="sls-grow" />
                {speaker.available && (
                  <button type="button" className="sls-btn" onClick={() => (voiceOn ? (speaker.cancel(), setVoiceOn(false)) : setVoiceOn(true))}>
                    {voiceOn ? "🔊" : "🔈"}
                  </button>
                )}
              </div>
            </>
          ) : caption?.text ? (
            <p className={`sls-text${caption.from === "cue" ? " sls-text--cue" : ""}`}>
              {caption.who ? <strong>{caption.who}: </strong> : null}
              {caption.text}
            </p>
          ) : (
            <p className="sls-hint">Tap what you want to talk about, then Mark… to tell the agent.</p>
          )}
          {notice && <p className="sls-notice">{notice}</p>}
        </div>
      )}

      {showMarks && marks.length > 0 && (
        <ul className="sls-marks">
          {[...marks].reverse().map((m) => (
            <li key={m.id} className={`sls-mark sls-mark--${m.status ?? "open"}`}>
              <button type="button" className="sls-mark-open" onClick={() => openMark(m)}>
                <span className={`sls-glyph sls-glyph--${m.kind}`}>{KIND_GLYPH[m.kind]}</span>
                <span className="sls-mark-body">
                  <span className="sls-mark-where">
                    {m.member.split("/").pop()} · {m.focus.length ? m.focus.join(", ") : "whole drawing"}
                  </span>
                  {m.note && <span className="sls-mark-note">{m.note}</span>}
                  {m.answer && <span className="sls-mark-answer">↳ {m.answer}</span>}
                </span>
                <span className="sls-mark-status">{m.status ?? "open"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && drawing && (
        <p className="sls-hint">
          Not shown: {failed.map((f) => `${f.path} (${f.reason})`).join("; ")}
        </p>
      )}
    </div>
  );
}

export default DiagramStage;
