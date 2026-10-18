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

export interface DockTake {
  kind: "take";
  take: string;
  at: string;
  text: string;
  canvas?: { doc: string | null; kind: string | null; focus: string | null };
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
  steps?: unknown[];
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
  onPlay: (id: string) => void;
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
          className={`slc-talk-fab${live ? " slc-talk-fab--live" : ""}`}
          onClick={() => (live ? onRecord() : onOpenChange(true))}
          aria-label={live ? `Stop and send (${clock(recorder.seconds)})` : `Talk with ${who}${fresh ? `, ${fresh} new` : ""}`}
          title={live ? "Stop and send your take" : `Talk with ${who} about what is on the canvas`}
        >
          {live ? <span className="slc-talk-fab-clock">{clock(recorder.seconds)}</span> : "🎙"}
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
          <span className="slc-talk-title">🎙 Talk with {who}</span>
          <span className={`slc-talk-presence${line.away ? " slc-talk-presence--away" : ""}`} title={line.text} />
          <span className="slc-stage-spacer" />
          <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={() => onOpenChange(false)} aria-label="Close the conversation">
            ✕
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
                    on {fileOf(item.canvas.doc)}
                    {item.canvas.focus ? ` · ${item.canvas.focus}` : ""}
                  </div>
                )}
                <div className="slc-talk-text">{item.text || "(no transcript yet)"}</div>
              </li>
            ) : (
              <li key={`r${item.id}`} className={`slc-talk-entry slc-talk-entry--reply${unheard.includes(item.id) ? " slc-talk-entry--new" : ""}`}>
                <div className="slc-talk-who">
                  <strong>{who}</strong>
                  <span>{when(item.at)}</span>
                  {!item.unvoiced &&
                    (playing === item.id ? (
                      <button type="button" className="slc-stage-btn slc-talk-play slc-talk-play--on" onClick={onStop} aria-label="Stop">
                        ■
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="slc-stage-btn slc-talk-play"
                        onClick={() => onPlay(item.id)}
                        disabled={live}
                        title={item.steps?.length ? `Hear ${who} walk the diagram (${item.steps.length} steps)` : `Hear ${who}`}
                      >
                        ▶{unheard.includes(item.id) ? " New" : ""}
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
                          {v === "up" ? "👍" : "👎"}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                {(item.steps?.length ?? 0) > 0 && <div className="slc-talk-canvas">walks the diagram in {item.steps!.length} steps</div>}
                <div className="slc-talk-text">{item.text}</div>
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
