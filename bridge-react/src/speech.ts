/**
 * The browser's own voice and ears, for a stage (Spec 83). No dependency, no
 * service: the Web Speech API where the browser has it, nothing where it does
 * not — `browserVoice()` and `browserDictation()` answer null, and the stage
 * reads its captions and the person types.
 *
 * A step that carries a recording (`audio`, rendered by an agent's own voice
 * service) is played as it is; only a step without one is read by the
 * browser. Both stay off until the person turns them on: a canvas that starts
 * talking by itself is not one anybody asked for.
 */
import type { TourStep } from "@miadi/stateloom-protocol";
import { stepHoldMs } from "@miadi/stateloom-protocol";
import type { StageVoice } from "./stage.js";

export interface BrowserVoiceOptions {
  lang?: string;
  rate?: number;
  /** A voice by name, when the browser has it (`speechSynthesis.getVoices()`). */
  voiceName?: string;
  /** Play a step's `audio` when it has one. Default true. */
  recordings?: boolean;
  /**
   * Read a step that has no recording with the browser's voice. Default true. False for a
   * companion's reply: one that could not be voiced is shown for its reading time instead
   * of being spoken in a voice that is not hers.
   */
  speech?: boolean;
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/** The part of `SpeechRecognition` used here (the type is not in every DOM lib). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function browserVoice(options: BrowserVoiceOptions = {}): StageVoice | null {
  if (typeof window === "undefined") return null;
  const synth = window.speechSynthesis;
  const canPlay = typeof Audio !== "undefined";
  if (!synth && !canPlay) return null;
  let audio: HTMLAudioElement | null = null;
  let finish: (() => void) | null = null;

  const done = (): void => {
    const f = finish;
    finish = null;
    f?.();
  };

  const cancel = (): void => {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      audio.pause();
      audio = null;
    }
    if (synth?.speaking || synth?.pending) synth.cancel();
    done();
  };

  return {
    speak(step: TourStep): Promise<void> {
      cancel();
      return new Promise<void>((resolve) => {
        // Some browsers never fire `end` (a voice that failed to load, a tab
        // in the background): the step is let go after twice its reading time.
        let safety = setTimeout(done, stepHoldMs({ ...step, holdMs: undefined }) * 2 + 4000);
        finish = () => {
          clearTimeout(safety);
          resolve();
        };
        if (step.audio && canPlay && options.recordings !== false) {
          const own = new Audio(step.audio);
          audio = own;
          own.onended = done;
          own.onerror = done;
          // A recording knows its own length once it plays: a slow voice, or one rendered
          // when asked for, is not cut at the reading-time guess.
          own.onplaying = () => {
            if (audio !== own || !Number.isFinite(own.duration)) return;
            clearTimeout(safety);
            safety = setTimeout(done, (own.duration - own.currentTime) * 1000 + 4000);
          };
          own.play().catch(done);
          return;
        }
        if (options.speech === false) {
          const held = setTimeout(done, stepHoldMs(step));
          const prior = finish;
          finish = () => {
            clearTimeout(held);
            prior?.();
          };
          return;
        }
        if (!synth || !step.say?.trim()) return done();
        const u = new SpeechSynthesisUtterance([step.title, step.say].filter(Boolean).join(". "));
        if (options.lang) u.lang = options.lang;
        if (options.rate) u.rate = options.rate;
        if (options.voiceName) {
          const v = synth.getVoices().find((x) => x.name === options.voiceName);
          if (v) u.voice = v;
        }
        u.onend = done;
        u.onerror = done;
        synth.speak(u);
      });
    },
    cancel,
  };
}

export interface Dictation {
  /** Listen; `onText` receives what was heard so far (final words, then the words still forming). */
  start(onText: (text: string, final: boolean) => void, onEnd?: (error?: string) => void): void;
  stop(): void;
}

/**
 * Two pieces of heard speech as one text. The browser hands each final segment as it
 * was recognised, and Safari's segments carry no space between them: "in between" then
 * "When it" read "in betweenWhen it". A space joins them when neither side has one, and
 * a space on both sides stays one.
 */
export function joinHeard(said: string, more: string): string {
  if (!more) return said;
  if (!said) return more;
  return `${said.trimEnd()} ${more.trimStart()}`;
}

/** The person speaks instead of typing. Null where the browser cannot listen (Firefox, most webviews). */
export function browserDictation(options: { lang?: string } = {}): Dictation | null {
  if (typeof window === "undefined") return null;
  const w = window as WindowWithSpeech;
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Recognition) return null;
  let rec: SpeechRecognitionLike | null = null;
  return {
    start(onText, onEnd) {
      rec?.stop();
      const r = new Recognition();
      rec = r;
      r.lang = options.lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
      r.continuous = true;
      r.interimResults = true;
      let finalText = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const words = result[0]?.transcript ?? "";
          if (result.isFinal) finalText = joinHeard(finalText, words);
          else interim = joinHeard(interim, words);
        }
        onText(joinHeard(finalText, interim).trim(), interim === "");
      };
      r.onerror = (e) => onEnd?.(e.error ?? "error");
      r.onend = () => {
        if (rec === r) rec = null;
        onEnd?.();
      };
      r.start();
    },
    stop() {
      rec?.stop();
      rec = null;
    },
  };
}
