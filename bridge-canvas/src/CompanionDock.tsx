/**
 * Talking with a companion from the canvas (Spec 84) — the dock.
 *
 * The phone page's conversation, folded into a corner of the board: one button records a
 * take (Record → Stop & send → Sending…, Send again when a send failed), the line under
 * it says what happened, and the conversation reads newest first — the person's takes
 * (with the drawing they were looking at) and the companion's replies, each with ▶ to
 * hear it walk the diagram again, and a thumb. Closed, it is one round button that shows
 * the clock while recording and how many replies are new.
 *
 * Props in, callbacks out: the host holds the recorder, the conversation and the stage
 * (`createTakeRecorder`, `createCompanionThread`, `present` in `@miadi/stateloom-react`).
 */
import type { CSSProperties } from "react";
import { themeStyle, type CanvasTheme } from "./theme.js";
import { CloseIcon, MicIcon, PlayIcon, SpeakerIcon, StopIcon, ThumbDownIcon, ThumbUpIcon } from "./icons.js";

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
}

export type DockItem = DockTake | DockReply;

export interface CompanionDockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

function presenceLine(who: string, presence: CompanionDockProps["presence"], episode: string | null): { text: string; away: boolean } {
  if (!episode) return { text: "Choose the episode you are speaking in.", away: true };
  switch (presence?.state) {
    case "listening":
      return { text: `${who} is listening.`, away: false };
    case "answering":
      return { text: `${who} is answering${presence.takes?.length ? ` take ${presence.takes.join(", ")}` : ""}.`, away: false };
    case "answered":
      return { text: `${who} has answered and is getting ready to listen again.`, away: false };
    default:
      return { text: `Nobody is listening yet. A take waits in the episode until ${who} does.`, away: true };
  }
}

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

  const line = presenceLine(who, presence, episode);
  const newest = [...items].reverse();

  return (
    <div className={`slc-talk slc-talk--open${className ? ` ${className}` : ""}`} style={{ ...themeStyle(theme), ...style }}>
      <section className="slc-talk-panel" aria-label={`Conversation with ${who}`} onPointerDown={(e) => e.stopPropagation()}>
        <header className="slc-talk-head">
          <span className="slc-talk-title">
            <MicIcon /> Talk with {who}
          </span>
          <span className={`slc-talk-presence${line.away ? " slc-talk-presence--away" : ""}`} title={line.text} />
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
          {newest.length === 0 && <li className="slc-stage-empty">Nothing said in this episode yet. Look at a drawing, press Record, and speak.</li>}
          {newest.map((item) =>
            item.kind === "take" ? (
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
