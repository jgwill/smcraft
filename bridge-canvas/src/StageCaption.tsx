/**
 * The words of the step on stage, and the buttons that move a tour (Spec 83).
 *
 * A card over the bottom of the board: who is presenting, the tour and the
 * step's title, what the agent says, where the tour stands. The controls are
 * the person's: back, play or pause, forward, the voice on or off, answer
 * (the host opens a mark on what is lit), close. Nothing here plays anything;
 * the buttons call the host, which holds the stage session.
 */
import type { CSSProperties } from "react";
import type { TourStep } from "@miadi/stateloom-protocol";
import { themeStyle, type CanvasTheme } from "./theme.js";
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, SpeakerIcon, SpeakerOffIcon } from "./icons.js";

export interface StageCaptionProps {
  shown: {
    step: TourStep;
    index: number | null;
    count: number | null;
    title?: string;
    origin?: string;
  } | null;
  playing?: boolean;
  speaking?: boolean;
  /** The canvas's voice is on. Absent: no voice button. */
  voice?: boolean;
  onToggleVoice?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onGoto?: (index: number) => void;
  onClose?: () => void;
  /** Answer what is lit: the host opens a mark on it. Absent: no answer button. */
  onAnswer?: () => void;
  theme?: Partial<CanvasTheme>;
  className?: string;
  style?: CSSProperties;
}

/** Past this many steps the dots give way to the count alone. */
const MAX_DOTS = 24;

export function StageCaption({
  shown,
  playing = false,
  speaking = false,
  voice,
  onToggleVoice,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onGoto,
  onClose,
  onAnswer,
  theme,
  className,
  style,
}: StageCaptionProps) {
  if (!shown) return null;
  const { step, index, count, title, origin } = shown;
  const inTour = index !== null && count !== null;
  const heading = [title, step.title].filter(Boolean).join(" · ");

  return (
    <section
      className={`slc-stage-caption${className ? ` ${className}` : ""}`}
      style={{ ...themeStyle(theme), ...style }}
      role="region"
      aria-label="What the agent is showing"
      aria-live="polite"
    >
      <header className="slc-stage-caption-head">
        {origin && <span className="slc-stage-caption-origin">{origin}</span>}
        {heading && <span className="slc-stage-caption-title">{heading}</span>}
        {inTour && (
          <span className="slc-stage-caption-count">
            {index! + 1} / {count}
          </span>
        )}
        {speaking && <span className="slc-stage-caption-speaking" aria-label="speaking" />}
        {onClose && (
          <button type="button" className="slc-stage-btn slc-stage-btn--quiet" onClick={onClose} aria-label="Close" title="Close">
            <CloseIcon />
          </button>
        )}
      </header>

      <p className="slc-stage-caption-say">{step.say}</p>

      {inTour && count! <= MAX_DOTS && count! > 1 && (
        <nav className="slc-stage-dots" aria-label="Steps">
          {Array.from({ length: count! }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`slc-stage-dot${i === index ? " slc-stage-dot--current" : i < index! ? " slc-stage-dot--seen" : ""}`}
              onClick={() => onGoto?.(i)}
              aria-label={`Step ${i + 1}`}
              aria-current={i === index ? "step" : undefined}
            />
          ))}
        </nav>
      )}

      <footer className="slc-stage-caption-controls">
        {inTour && (
          <>
            <button type="button" className="slc-stage-btn" onClick={onPrev} disabled={index === 0} aria-label="Previous step" title="Previous step">
              <PrevIcon />
            </button>
            {playing ? (
              <button type="button" className="slc-stage-btn slc-stage-btn--main" onClick={onPause} aria-label="Pause" title="Pause">
                <PauseIcon />
              </button>
            ) : (
              <button type="button" className="slc-stage-btn slc-stage-btn--main" onClick={onPlay} aria-label="Play" title="Play">
                <PlayIcon />
              </button>
            )}
            <button type="button" className="slc-stage-btn" onClick={onNext} disabled={index === count! - 1} aria-label="Next step" title="Next step">
              <NextIcon />
            </button>
          </>
        )}
        <span className="slc-stage-spacer" />
        {voice !== undefined && (
          <button
            type="button"
            className={`slc-stage-btn${voice ? " slc-stage-btn--on" : ""}`}
            onClick={onToggleVoice}
            aria-pressed={voice}
            title={voice ? "Voice on — the steps are read aloud" : "Voice off — the steps are read on screen"}
          >
            {voice ? <SpeakerIcon /> : <SpeakerOffIcon />}
          </button>
        )}
        {onAnswer && (
          <button type="button" className="slc-stage-btn slc-stage-btn--answer" onClick={onAnswer} title="Answer — mark what is lit and say something about it">
            Answer
          </button>
        )}
      </footer>
    </section>
  );
}

export default StageCaption;
