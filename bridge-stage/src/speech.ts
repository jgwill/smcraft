/**
 * The browser's own voice, both ways: `speak` reads a caption aloud with
 * `speechSynthesis`, `listen` turns speech into words with the Web Speech
 * recognizer where the browser has one (Chrome on Android does). Neither
 * needs a server. Both degrade to "not available" and never throw.
 */

export interface Speaker {
  available: boolean;
  /** Resolves when the words are said, or at once when they cannot be. */
  speak(text: string, options?: { lang?: string; rate?: number; voiceName?: string }): Promise<void>;
  cancel(): void;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

export function browserSpeaker(): Speaker {
  const s = synth();
  if (!s) return { available: false, speak: async () => {}, cancel: () => {} };
  return {
    available: true,
    speak(text, options = {}) {
      return new Promise<void>((resolve) => {
        s.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = options.lang ?? "en-US";
        u.rate = options.rate ?? 1;
        if (options.voiceName) {
          const voice = s.getVoices().find((v) => v.name === options.voiceName);
          if (voice) u.voice = voice;
        }
        // A long utterance on Android can end without `end` when the tab is
        // backgrounded; a ceiling keeps a tour from hanging on it.
        const ceiling = setTimeout(resolve, Math.max(8000, text.length * 120));
        const done = () => {
          clearTimeout(ceiling);
          resolve();
        };
        u.onend = done;
        u.onerror = done;
        s.speak(u);
      });
    },
    cancel() {
      s.cancel();
    },
  };
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function recognizer(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export function canListen(): boolean {
  return recognizer() !== null;
}

export interface Listening {
  stop(): void;
}

/**
 * Listen until the person stops or `stop()` is called. `onText` receives the
 * whole transcript so far each time it grows; `onEnd` fires once.
 */
export function listen(
  onText: (text: string, final: boolean) => void,
  onEnd: (error?: string) => void,
  lang = "en-US",
): Listening | null {
  const Ctor = recognizer();
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = true;
  let ended = false;
  r.onresult = (e) => {
    let text = "";
    let final = true;
    for (let i = 0; i < e.results.length; i += 1) {
      text += e.results[i][0]?.transcript ?? "";
      if (!e.results[i].isFinal) final = false;
    }
    onText(text.trim(), final);
  };
  r.onerror = (e) => {
    if (!ended) {
      ended = true;
      onEnd(e.error);
    }
  };
  r.onend = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  r.start();
  return { stop: () => r.stop() };
}
