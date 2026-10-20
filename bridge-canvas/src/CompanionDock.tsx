/**
 * Talking with a companion from the canvas (Spec 84) — the dock.
 *
 * The phone page's conversation, folded into a corner of the board: one button records a
 * take (Record → Stop & send → Sending…, Send again when a send failed), the line under
 * it says what happened, and the conversation reads newest first — the person's takes
 * (with the drawing they were looking at), the companion's replies, each with ▶ to hear
 * it walk the diagram again and a thumb, and the person's marks on the episode's drawings
 * with their threads ("You marked Witnessing on Screenwalk", the words, the companion's
 * answers, whether it waits). A mark has no play button and no thumb; tapping it opens
 * that drawing at that mark (`onOpenMark`). A reply that answers a mark says which.
 *
 * Who is in the room is said in words in the header ("listening", "answering take 12",
 * "away"), never by a coloured dot alone. Closed, it is one round button (`variant:
 * "fab"`) that shows the clock while recording and how many replies are new, or — on a
 * phone, where the host makes it the handle of the sheet at the bottom of the board —
 * a bar across the width (`variant: "bar"`) that says the same in words.
 *
 * Props in, callbacks out: the host holds the recorder, the conversation and the stage
 * (`createTakeRecorder`, `createCompanionThread`, `present` in `@miadi/stateloom-react`).
 */
import type { CSSProperties } from "react";
import { themeStyle, type CanvasTheme } from "./theme.js";
import { CloseIcon, MicIcon, PinIcon, PlayIcon, SpeakerIcon, StopIcon, ThumbDownIcon, ThumbUpIcon } from "./icons.js";
import { drawingName, markPlace, markStanding, marksSummary } from "./names.js";

export interface DockTake {
  kind: "take";
  take: string;
  at: string;
  text: string;
  canvas?: { doc: string | null; kind: string | null; focus: string | null; step?: { title?: string; index?: number; count?: number } | null };
}

/** One step of a reply that walks the diagram: what is said, on which drawing, lighting what. */
export interface DockStep {
  say: string;
  title?: string;
  doc?: string;
  focus?: string;
  spotlight?: string[];
}

export interface DockReply {
  kind: "reply";
  id: string;
  take: string | null;
  text: string;
  at: string;
  audio: string | null;
  unvoiced?: string;
  feedback?: "up" | "down";
  steps?: DockStep[];
  /** The mark this reply answers, in its thread and in the companion's voice. */
  mark?: { id: string; doc: string };
}

/** A person's (or the companion's) mark on one of the episode's drawings, with its thread. */
export interface DockMark {
  kind: "mark";
  id: string;
  /** The drawing, absolute. */
  doc: string;
  /** Its file name. */
  drawing?: string;
  /** Its own name (settings.name), when it has one. */
  title?: string;
  elements: string[];
  region?: { x: number; y: number; width: number; height: number };
  text: string;
  author: { name: string; role: "person" | "agent" };
  at: string;
  lastAt?: string;
  status: "open" | "answered" | "resolved";
  replies: { author: { name: string; role: "person" | "agent" }; text: string; at: string }[];
}

export type DockItem = DockTake | DockReply | DockMark;

export interface CompanionDockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Closed: a round button (default), or a bar across the width that names the room in words. */
  variant?: "fab" | "bar";
  /** Open the drawing a mark is on, at that mark's thread. Absent: marks are read, not opened. */
  onOpenMark?: (mark: DockMark) => void;
  /** Who answers. Default "Mia". */
  who?: string;
  episode: string | null;
  episodes?: readonly { path: string; number: number }[];
  onEpisode?: (path: string) => void;
  presence: { state: string; takes?: string[] } | null;
  recorder: { state: "idle" | "starting" | "recording" | "sending" | "retry"; seconds: number; held: number; message: string; error: boolean; unavailable?: string };
  onRecord: () => void;
  items: readonly DockItem[];
  /** Replies that arrived and were not heard yet. */
  unheard?: readonly string[];
  /** The reply being heard now. */
  playing?: string | null;
  /** The step of that reply on the board now, counted from 0. */
  playingStep?: number | null;
  /** Play a reply; `from` starts a reply with steps at that step (from 0). */
  onPlay: (id: string, from?: number) => void;
  onStop?: () => void;
  onFeedback?: (id: string, value: "up" | "down" | "") => void;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
  /** A take waiting for its reply, and for how long. */
  waiting?: { take: string; seconds: number } | null;
  notice?: string | null;
  error?: string | null;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const fileOf = (p: string | null | undefined) => (p ? p.split("/").pop() ?? p : "");
/** A drawing named for a person: its file name without the format's extensions. */
const drawingOf = (p: string | null | undefined) => fileOf(p).replace(/\.(smdf|erdf|sqdf|sysdf)\.json$/i, "").replace(/\.json$/i, "");
/** What a step lights, said briefly: the element's own name, or how many. */
function litOf(step: DockStep): string {
  const names = step.spotlight?.length ? step.spotlight : step.focus ? [step.focus] : [];
  // A message is known by its number on the drawing; everything else by its name.
  const bare = names.map((n) => (n.startsWith("message:") ? `#${n.slice(8)}` : n.slice(n.indexOf(":") + 1)));
  if (!bare.length) return "";
  return bare.length <= 2 ? bare.join(", ") : `${bare.slice(0, 2).join(", ")} +${bare.length - 2}`;
}

function presenceLine(who: string, presence: CompanionDockProps["presence"], episode: string | null): { text: string; word: string; away: boolean } {
  if (!episode) return { text: "Choose the episode you are speaking in.", word: "no episode", away: true };
  switch (presence?.state) {
    case "listening":
      return { text: `${who} is listening.`, word: "listening", away: false };
    case "answering": {
      const takes = presence.takes?.length ? ` take ${presence.takes.join(", ")}` : "";
      return { text: `${who} is answering${takes}.`, word: `answering${takes}`, away: false };
    }
    case "answered":
      return { text: `${who} has answered and is getting ready to listen again.`, word: "answered", away: false };
    default:
      return { text: `Nobody is listening yet. A take waits in the episode until ${who} does.`, word: "away", away: true };
  }
}

/** Who said it, as the conversation names them: the person is "You". */
const speaker = (author: { name?: string; role?: string }, who: string) => (author.role === "agent" ? author.name || who : "You");

const STANDING_TEXT = (who: string): Record<ReturnType<typeof markStanding>, string> => ({
  "waits for agent": `waits for ${who}`,
  "waits for you": "waits for you",
  answered: "answered",
  resolved: "resolved",
});

const RECORD_LABEL: Record<CompanionDockProps["recorder"]["state"], string> = {
  idle: "● Record",
  starting: "Opening the mic…",
  recording: "■ Stop & send",
  sending: "Sending…",
  retry: "Send again",
};

export function CompanionDock({
  open,
  onOpenChange,
  variant = "fab",
  onOpenMark,
  who = "Mia",
  episode,
  episodes,
  onEpisode,
  presence,
  recorder,
  onRecord,
  items,
  unheard = [],
  playing = null,
  playingStep = null,
  onPlay,
  onStop,
  onFeedback,
  autoplay,
  onAutoplay,
  waiting,
  notice,
  error,
  theme,
  className,
  style,
}: CompanionDockProps) {
  const live = recorder.state === "recording";
  const busy = recorder.state === "starting" || recorder.state === "sending";
  const fresh = unheard.length;

  const line = presenceLine(who, presence, episode);

  if (!open && variant === "bar") {
    return (
      <div className={`slc-talk slc-talk--bar${className ? ` ${className}` : ""}`} style={{ ...themeStyle(theme), ...style }}>
        <button
          type="button"
          className={`slc-talk-bar${live ? " slc-talk-bar--live" : ""}${!live && playing ? " slc-talk-bar--speaking" : ""}`}
          onClick={() => (live ? onRecord() : onOpenChange(true))}
          aria-label={live ? `Stop and send (${clock(recorder.seconds)})` : `Talk with ${who}: ${line.word}${fresh ? `, ${fresh} new` : ""}. Open the conversation`}
          title={live ? "Stop and send your take" : `Talk with ${who} about what is on the canvas`}
        >
          {live ? <StopIcon /> : playing ? <SpeakerIcon /> : <MicIcon />}
          <span className="slc-talk-bar-title">{live ? "Stop and send" : playing ? `${who} is speaking` : `Talk with ${who}`}</span>
          {live ? (
            <span className="slc-talk-clock">{clock(recorder.seconds)}</span>
          ) : (
            !playing && <span className={`slc-talk-state${line.away ? " slc-talk-state--away" : ""}`}>{line.word}</span>
          )}
          <span className="slc-stage-spacer" />
          {!live && fresh > 0 && <span className="slc-talk-new">{fresh} new</span>}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={`slc-talk${className ? ` ${className}` : ""}`} style={{ ...themeStyle(theme), ...style }}>
        <button
          type="button"
          className={`slc-talk-fab${live ? " slc-talk-fab--live" : ""}${!live && playing ? " slc-talk-fab--speaking" : ""}`}
          onClick={() => (live ? onRecord() : onOpenChange(true))}
          aria-label={
            live ? `Stop and send (${clock(recorder.seconds)})` : playing ? `${who} is speaking. Open the conversation` : `Talk with ${who}${fresh ? `, ${fresh} new` : ""}`
          }
          title={live ? "Stop and send your take" : playing ? `${who} is walking the diagram` : `Talk with ${who} about what is on the canvas`}
        >
          {live ? <span className="slc-talk-fab-clock">{clock(recorder.seconds)}</span> : playing ? <SpeakerIcon size={24} /> : <MicIcon size={24} />}
          {!live && fresh > 0 && <span className="slc-talk-fab-badge">{fresh}</span>}
        </button>
      </div>
    );
  }

  const newest = [...items].reverse();
  const marks = items.filter((i): i is DockMark => i.kind === "mark");
  const marksById = new Map(marks.map((m) => [m.id, m]));
  const saidAny = items.some((i) => i.kind === "take" || i.kind === "reply");
  const standing = STANDING_TEXT(who);
  /** "Witnessing on Screenwalk": what a mark points at, on which drawing. */
  const placeOf = (m: DockMark) => `${markPlace(m)} on ${drawingName(m.doc ?? m.drawing, m.title)}`;

  return (
    <div className={`slc-talk slc-talk--open${className ? ` ${className}` : ""}`} style={{ ...themeStyle(theme), ...style }}>
      <section className="slc-talk-panel" aria-label={`Conversation with ${who}`} onPointerDown={(e) => e.stopPropagation()}>
        <header className="slc-talk-head">
          <span className="slc-talk-title">
            <MicIcon /> Talk with {who}
          </span>
          <span className={`slc-talk-state${line.away ? " slc-talk-state--away" : ""}`} title={line.text}>
            {line.word}
          </span>
          <span className="slc-stage-spacer" />
          <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={() => onOpenChange(false)} aria-label="Close the conversation">
            <CloseIcon />
          </button>
        </header>

        {episodes?.length && onEpisode ? (
          <select
            className="slc-stage-input slc-talk-episode"
            value={episode ?? ""}
            onChange={(e) => onEpisode(e.target.value)}
            disabled={live || busy}
            aria-label="The episode this conversation belongs to"
          >
            {!episode && <option value="">Choose the episode…</option>}
            {episodes.map((ep) => (
              <option key={ep.path} value={ep.path}>
                {ep.number ? `${String(ep.number).padStart(3, "0")} · ` : ""}
                {ep.path.replace(/^\d{4}-\d{2}-\d{2}-episode-\d+-/, "")}
              </option>
            ))}
          </select>
        ) : (
          <div className="slc-talk-meta">{episode ?? "No episode chosen."}</div>
        )}
        <div className={`slc-talk-meta${line.away ? " slc-talk-meta--away" : ""}`}>{line.text}</div>

        <button
          type="button"
          className={`slc-talk-record${live ? " slc-talk-record--live" : ""}${recorder.state === "retry" ? " slc-talk-record--retry" : ""}`}
          onClick={onRecord}
          disabled={busy || !!recorder.unavailable || !episode}
          title={recorder.unavailable ? `Cannot record: ${recorder.unavailable}` : live ? "Stop and send your take" : "Speak to the episode, about what is on the canvas"}
        >
          {RECORD_LABEL[recorder.state]}
          {live && <span className="slc-talk-clock">{clock(recorder.seconds)}</span>}
        </button>
        {recorder.unavailable && <div className="slc-talk-meta slc-talk-meta--error">Cannot record here: {recorder.unavailable}.</div>}
        {recorder.message && <div className={`slc-talk-meta${recorder.error ? " slc-talk-meta--error" : ""}`}>{recorder.message}</div>}
        {waiting && <div className="slc-talk-meta">Waiting for {who}… {clock(waiting.seconds)}</div>}
        {notice && <div className="slc-talk-notice">{notice}</div>}
        {error && <div className="slc-talk-meta slc-talk-meta--error">{error}</div>}

        <label className="slc-talk-toggle">
          <input type="checkbox" checked={autoplay} onChange={(e) => onAutoplay(e.target.checked)} />
          Play {who}'s replies on the diagram as they arrive
        </label>

        <ol className="slc-talk-thread">
          {newest.length === 0 && (
            <li className="slc-stage-empty">Nothing said or marked in this episode yet. Look at a drawing, press Record, and speak, or mark it.</li>
          )}
          {!saidAny && marks.length > 0 && (
            <li className="slc-stage-empty">
              {marksSummary(marks, who)}. Nothing said by voice yet.
            </li>
          )}
          {newest.map((item) =>
            item.kind === "mark" ? (
              <li key={`m${item.id}`} className={`slc-talk-entry slc-talk-entry--mark${markStanding(item) === "waits for agent" ? " slc-talk-entry--waits" : ""}`}>
                <button
                  type="button"
                  className="slc-talk-mark"
                  onClick={() => onOpenMark?.(item)}
                  disabled={!onOpenMark}
                  title={`Open ${drawingName(item.doc ?? item.drawing, item.title)} at this mark`}
                >
                  <span className="slc-talk-who">
                    <PinIcon size={14} />
                    <span className="slc-talk-mark-head">
                      <strong>{speaker(item.author, who)}</strong> marked {placeOf(item)}
                    </span>
                    <span>{when(item.at)}</span>
                  </span>
                  <span className="slc-talk-text">{item.text}</span>
                  {item.replies.length > 0 && (
                    <span className="slc-talk-mark-replies">
                      {item.replies.map((r, i) => (
                        <span key={i} className={`slc-talk-mark-reply slc-talk-mark-reply--${r.author.role}`}>
                          <span className="slc-talk-mark-by">
                            {speaker(r.author, who)}
                            {r.at ? ` · ${when(r.at)}` : ""}
                          </span>
                          <span className="slc-talk-text">{r.text}</span>
                        </span>
                      ))}
                    </span>
                  )}
                  <span className={`slc-talk-mark-state${markStanding(item) === "waits for agent" ? " slc-talk-mark-state--waits" : ""}`}>
                    {standing[markStanding(item)]}
                  </span>
                </button>
              </li>
            ) : item.kind === "take" ? (
              <li key={`t${item.take}`} className="slc-talk-entry slc-talk-entry--take">
                <div className="slc-talk-who">
                  <strong>You</strong>
                  <span>
                    take {item.take} · {when(item.at)}
                  </span>
                </div>
                {item.canvas?.doc && (
                  <div className="slc-talk-canvas">
                    on {drawingOf(item.canvas.doc)}
                    {item.canvas.focus ? ` · ${item.canvas.focus.slice(item.canvas.focus.indexOf(":") + 1)}` : ""}
                    {item.canvas.step?.title ? ` · during “${item.canvas.step.title}”` : ""}
                  </div>
                )}
                <div className="slc-talk-text">{item.text || "(no transcript yet)"}</div>
              </li>
            ) : (
              <li key={`r${item.id}`} className={`slc-talk-entry slc-talk-entry--reply${unheard.includes(item.id) ? " slc-talk-entry--new" : ""}`}>
                <div className="slc-talk-who">
                  <strong>{who}</strong>
                  <span>{when(item.at)}</span>
                  {(!item.unvoiced || (item.steps?.length ?? 0) > 0) &&
                    (playing === item.id ? (
                      <button type="button" className="slc-stage-btn slc-talk-play slc-talk-play--on" onClick={onStop} aria-label="Stop" title="Stop">
                        <StopIcon />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="slc-stage-btn slc-talk-play"
                        onClick={() => onPlay(item.id)}
                        disabled={live}
                        title={
                          item.unvoiced
                            ? `Walk the diagram with ${who}'s words (no voice)`
                            : item.steps?.length
                              ? `Hear ${who} walk the diagram (${item.steps.length} steps)`
                              : `Hear ${who}`
                        }
                      >
                        <PlayIcon />
                        {(item.steps?.length ?? 0) > 0 ? <span>Walk {item.steps!.length} steps</span> : null}
                        {unheard.includes(item.id) ? <span className="slc-talk-new">New</span> : null}
                      </button>
                    ))}
                  {onFeedback && (
                    <span className="slc-talk-thumbs">
                      {(["up", "down"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={`slc-talk-thumb${item.feedback === v ? " slc-talk-thumb--on" : ""}`}
                          onClick={() => onFeedback(item.id, item.feedback === v ? "" : v)}
                          aria-label={v === "up" ? "This reply worked" : "This reply missed"}
                        >
                          {v === "up" ? <ThumbUpIcon size={15} /> : <ThumbDownIcon size={15} />}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                {item.mark && (
                  <button
                    type="button"
                    className="slc-talk-answers"
                    onClick={() => {
                      const m = marksById.get(item.mark!.id);
                      if (m) onOpenMark?.(m);
                    }}
                    disabled={!onOpenMark || !marksById.has(item.mark.id)}
                  >
                    <PinIcon size={13} />
                    answers your mark on {marksById.has(item.mark.id) ? placeOf(marksById.get(item.mark.id)!) : drawingName(item.mark.doc)}
                  </button>
                )}
                {(item.steps?.length ?? 0) > 0 ? (
                  <ol className="slc-talk-steps" aria-label={`${who}'s walk through the diagram`}>
                    {item.steps!.map((step, i) => {
                      const here = playing === item.id && playingStep === i;
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            className={`slc-talk-step${here ? " slc-talk-step--here" : ""}`}
                            onClick={() => onPlay(item.id, i)}
                            disabled={live}
                            aria-current={here ? "step" : undefined}
                            title={`Walk from step ${i + 1}`}
                          >
                            <span className="slc-talk-step-n">{i + 1}</span>
                            <span className="slc-talk-step-body">
                              {(step.title || step.doc) && (
                                <span className="slc-talk-step-head">
                                  {step.title && <strong>{step.title}</strong>}
                                  {(step.doc || litOf(step)) && (
                                    <span className="slc-talk-step-where">
                                      {[drawingOf(step.doc), litOf(step)].filter(Boolean).join(" · ")}
                                    </span>
                                  )}
                                </span>
                              )}
                              <span className="slc-talk-step-say">{step.say}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <div className="slc-talk-text">{item.text}</div>
                )}
                {item.unvoiced && <div className="slc-talk-meta">{item.unvoiced}</div>}
              </li>
            ),
          )}
        </ol>
      </section>
    </div>
  );
}

export default CompanionDock;
