/**
 * Talking with a companion from the canvas (Spec 84) — the browser half of the Mia
 * episode companion's phone page, made reusable.
 *
 * The companion is a phone-capture service (jgwill/miadi-orchestration-kit
 * `claude/mia-episode-companion/phone-capture`): a take recorded here lands in a
 * Chronicle episode, is transcribed, and wakes the seat listening there; the seat's
 * reply comes back as text, voiced as Mia, and — new with Spec 84 — as steps that walk
 * the person through the diagram while each step's words play.
 *
 * Two objects, no React:
 *
 * - `createTakeRecorder` — the phone page's recorder: one state machine (idle →
 *   starting → recording → sending, retry), what it captured sent every 10 s as a
 *   backup part at the offset the service holds, the whole take on Stop, a failed send
 *   kept for Send again, diagnostics on what went wrong, and a heartbeat while the
 *   microphone is open so a reply posted then waits in silence. It records audio/mp4
 *   where the browser can, and WAV where it cannot (the service takes no webm).
 * - `createCompanionThread` — the conversation: takes and replies in order, who is in
 *   the room, polled every 10 s and every 4 s while a take waits for its reply; a reply
 *   that arrives while the page is open is announced once (`onReply`).
 *
 * `base` is where the service's `/api/` answers from this page: the canvas proxies it
 * as `/api/companion/` (`companionUrl` turns the service's own relative audio paths
 * into that address).
 */
import type { StageContext, TourDefinition, TourStep } from "@miadi/stateloom-protocol";

// ─── The conversation's shapes, as the service answers ───────────────

export interface CompanionPresence {
  state: "listening" | "answering" | "answered" | "away";
  takes?: string[];
}

export interface CompanionTake {
  kind: "take";
  take: string;
  at: string;
  text: string;
  /** The canvas the take was spoken at, when it was spoken at one. */
  canvas?: { doc: string | null; kind: string | null; focus: string | null };
}

export interface CompanionReplyStep extends TourStep {
  /** The step's own voice, relative to the service (`api/replies/<id>/steps/<n>/audio`). */
  audio?: string;
}

export interface CompanionReply {
  kind: "reply";
  id: string;
  episode: string;
  take: string | null;
  text: string;
  at: string;
  /** The whole reply's voice, relative to the service. Null until rendered. */
  audio: string | null;
  unvoiced?: string;
  feedback?: "up" | "down";
  related?: { label: string; href: string; kind: string }[];
  steps?: CompanionReplyStep[];
}

export type CompanionItem = CompanionTake | CompanionReply;

/** The service's relative path (`api/replies/…`) as this page reaches it. */
export function companionUrl(base: string, path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  const tail = path.replace(/^\/?api\//, "");
  return `${base.endsWith("/") ? base : `${base}/`}${tail}`;
}

/**
 * A reply as a tour the stage can present: its steps, each heard in its own voice, or —
 * a reply without steps — one caption carrying the whole reply's voice. Steps name
 * drawings by absolute path, so the stage opens them as they are.
 */
export function replyTour(reply: CompanionReply, base: string, who = "Mia"): TourDefinition {
  const when = new Date(reply.at);
  const name = `${who}${Number.isNaN(when.getTime()) ? "" : ` · ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}`;
  const steps: TourStep[] = reply.steps?.length
    ? reply.steps.map(({ audio, ...step }) => ({ ...step, ...(companionUrl(base, audio) ? { audio: companionUrl(base, audio) } : {}) }))
    : [{ say: reply.text, ...(companionUrl(base, reply.audio ?? `api/replies/${reply.id}/audio`) ? { audio: companionUrl(base, reply.audio ?? `api/replies/${reply.id}/audio`) } : {}) }];
  return { settings: { namespace: "companion", name, author: who }, steps };
}

/** What a take carries of the canvas it was spoken at (the service keeps it as canvas.json). */
export function takeContext(ctx: Partial<StageContext> | null, extra: { marks?: string[]; spotlight?: string[]; url?: string } = {}): Record<string, unknown> | null {
  if (!ctx?.doc) return null;
  const out: Record<string, unknown> = {
    stage: ctx.stage, doc: ctx.doc, kind: ctx.kind, system: ctx.system, focus: ctx.focus ?? undefined,
    visible: ctx.visible, tour: ctx.tour, who: ctx.who, at: new Date().toISOString(), ...extra,
  };
  for (const key of Object.keys(out)) if (out[key] === undefined || out[key] === null) delete out[key];
  return out;
}

// ─── The recorder ────────────────────────────────────────────────────

export type RecorderState = "idle" | "starting" | "recording" | "sending" | "retry";

export interface RecorderSnapshot {
  state: RecorderState;
  /** Seconds recorded so far (while recording), or of the take being sent. */
  seconds: number;
  /** Bytes of this recording the service already holds (the backup parts). */
  held: number;
  /** One line for the person; `error` when it is a failure. */
  message: string;
  error: boolean;
  /** The last take stored: its id, its words, who heard it. */
  stored: { take: string; english: string; transcriptError?: string; presence?: CompanionPresence } | null;
  /** The browser cannot record here (no microphone API, or no secure context). */
  unavailable?: string;
}

export interface TakeRecorderOptions {
  /** Where the service's /api/ answers from this page, e.g. `/api/companion/`. */
  base: string;
  /** The episode the take belongs to, read at Record. */
  episode: () => string | null;
  /** What the canvas shows, read at Record; kept with the take. */
  context?: () => Record<string, unknown> | null;
  onChange?: (s: RecorderSnapshot) => void;
  /** Called when a take is stored, to wait for its reply. */
  onStored?: (take: string) => void;
  partEveryMs?: number;
  beatEveryMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder?: (stream: MediaStream) => RecorderLike;
}

/** The part of MediaRecorder used here; the WAV fallback implements the same. */
export interface RecorderLike {
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: { error?: { name?: string; message?: string } }) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface TakeRecorder {
  getSnapshot(): RecorderSnapshot;
  /** Record, Stop & send, or Send again — what the one button does now. */
  press(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  resend(): Promise<void>;
  destroy(): void;
}

const MP4_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

/** The container this browser records the service can take: mp4, else WAV (built here). */
export function recordingType(): "mp4" | "wav" | null {
  if (typeof window === "undefined") return null;
  const MR = (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  if (MR && MP4_TYPES.some((t) => !MR.isTypeSupported || MR.isTypeSupported(t))) return "mp4";
  const AC = (window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  return AC ? "wav" : null;
}

function wavHeader(dataBytes: number, rate: number): ArrayBuffer {
  const h = new DataView(new ArrayBuffer(44));
  const put = (at: number, s: string) => [...s].forEach((c, i) => h.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  h.setUint32(4, 36 + dataBytes, true);
  put(8, "WAVE");
  put(12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, 1, true); // mono
  h.setUint32(24, rate, true);
  h.setUint32(28, rate * 2, true);
  h.setUint16(32, 2, true);
  h.setUint16(34, 16, true);
  put(36, "data");
  h.setUint32(40, dataBytes, true);
  return h.buffer;
}

/**
 * A recorder for browsers that record no mp4 (Firefox, older Chrome): 16-bit mono PCM
 * from the microphone, handed out as WAV. The first slice carries a header sized for a
 * stream (so the service's backup parts read as audio), and the blob at Stop is rebuilt
 * with the true size — the take sent whole is a well-formed file.
 */
export function wavRecorder(stream: MediaStream): RecorderLike {
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const pcm: Int16Array[] = [];
  let pending: Int16Array[] = [];
  let sentHeader = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const rec: RecorderLike = {
    mimeType: "audio/wav",
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start(timeslice = 1000) {
      node.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const out = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
        pcm.push(out);
        pending.push(out);
      };
      source.connect(node);
      node.connect(ctx.destination);
      const flush = () => {
        if (!pending.length) return;
        const parts: BlobPart[] = sentHeader ? [] : [wavHeader(0x7fffffff, ctx.sampleRate)];
        sentHeader = true;
        parts.push(...pending.map((p) => p.buffer as ArrayBuffer));
        pending = [];
        rec.ondataavailable?.({ data: new Blob(parts, { type: "audio/wav" }) });
      };
      timer = setInterval(flush, timeslice);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        // already disconnected
      }
      void ctx.close().catch(() => {});
      const bytes = pcm.reduce((n, p) => n + p.byteLength, 0);
      const whole = new Blob([wavHeader(bytes, ctx.sampleRate), ...pcm.map((p) => p.buffer as ArrayBuffer)], { type: "audio/wav" });
      (rec as RecorderLike & { whole?: Blob }).whole = whole;
      rec.onstop?.();
    },
  };
  return rec;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function createTakeRecorder(opts: TakeRecorderOptions): TakeRecorder {
  const base = opts.base.endsWith("/") ? opts.base : `${opts.base}/`;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const partEvery = opts.partEveryMs ?? 10_000;
  const beatEvery = opts.beatEveryMs ?? 15_000;
  const kind = recordingType();
  const secure = typeof window === "undefined" || window.isSecureContext !== false;
  const getUserMedia =
    opts.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
  const make =
    opts.createRecorder ??
    ((stream: MediaStream): RecorderLike => {
      if (kind === "mp4") {
        const MR = (window as unknown as { MediaRecorder: new (s: MediaStream, o: { mimeType: string }) => RecorderLike }).MediaRecorder;
        const type = MP4_TYPES.find((t) => (window as unknown as { MediaRecorder: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder.isTypeSupported?.(t) ?? true)!;
        return new MR(stream, { mimeType: type });
      }
      return wavRecorder(stream);
    });

  let snap: RecorderSnapshot = {
    state: "idle",
    seconds: 0,
    held: 0,
    message: "",
    error: false,
    stored: null,
    ...(!opts.createRecorder && (!kind || !secure)
      ? { unavailable: !secure ? "the microphone needs a secure page (https, or this machine's own address)" : "this browser cannot record audio" }
      : {}),
  };
  const set = (patch: Partial<RecorderSnapshot>) => {
    snap = { ...snap, ...patch };
    opts.onChange?.(snap);
  };

  let stream: MediaStream | null = null;
  let recorder: RecorderLike | null = null;
  let chunks: Blob[] = [];
  let rec = "";
  let episode = "";
  let context: string | null = null;
  let startedAt = 0;
  let pending: Blob | null = null;
  let partTimer: ReturnType<typeof setInterval> | null = null;
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  let clock: ReturnType<typeof setInterval> | null = null;
  let partBusy = false;

  const elapsed = () => (startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0);
  const typeOf = () => ((recorder?.mimeType || "audio/mp4").split(";")[0] || "audio/mp4");
  const query = (extra = "") =>
    `episode=${encodeURIComponent(episode)}${rec ? `&rec=${rec}` : ""}${context ? `&context=${encodeURIComponent(context)}` : ""}${extra}`;

  function tellRecorder(recording: boolean): void {
    if (!episode) return;
    void doFetch(`${base}recorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ episode, recording }),
    }).catch(() => {});
  }

  function diagnose(kindOf: string, detail: Record<string, unknown> = {}): void {
    if (!rec) return;
    const body = JSON.stringify({
      rec, episode, kind: kindOf, at: new Date().toISOString(), mime: recorder?.mimeType ?? kind,
      visibility: typeof document !== "undefined" ? document.visibilityState : "", agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      source: "stateloom-canvas", ...detail,
    });
    void doFetch(`${base}takes/diagnostic`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  }

  function stopTimers(): void {
    for (const t of [partTimer, beatTimer, clock]) if (t) clearInterval(t);
    partTimer = beatTimer = clock = null;
  }

  function releaseMic(): void {
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // gone already
    }
    stream = null;
  }

  // While recording, what was captured goes to the service every 10 s, so a recorder or a
  // page that fails loses at most those seconds. The offset moves only when it says so.
  async function sendPart(): Promise<void> {
    if (!rec || partBusy || !chunks.length) return;
    const whole = new Blob(chunks, { type: typeOf() });
    if (whole.size <= snap.held) return;
    partBusy = true;
    const mine = rec;
    try {
      const r = await doFetch(`${base}takes/part?${query(`&offset=${snap.held}`)}`, {
        method: "POST",
        headers: { "content-type": typeOf() },
        body: whole.slice(snap.held),
      });
      const answer = (await r.json()) as { bytes?: number };
      if (mine === rec && typeof answer.bytes === "number") set({ held: answer.bytes });
    } catch {
      // The next part carries these bytes too.
    } finally {
      partBusy = false;
    }
  }

  async function start(): Promise<void> {
    if (snap.state !== "idle" && snap.state !== "retry") return;
    if (snap.unavailable) return set({ message: `Cannot record: ${snap.unavailable}.`, error: true });
    episode = opts.episode() ?? "";
    if (!episode) return set({ message: "Choose the episode this take belongs to.", error: true });
    const ctx = opts.context?.() ?? null;
    context = ctx ? JSON.stringify(ctx).slice(0, 4000) : null;
    pending = null;
    set({ state: "starting", message: "", error: false, held: 0, seconds: 0 });
    tellRecorder(true);
    let media: MediaStream;
    try {
      media = await getUserMedia({ audio: true });
    } catch (e) {
      tellRecorder(false);
      return set({ state: "idle", message: `Microphone refused: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
    // A second press while the microphone prompt was open, or a destroy, changed the state.
    if ((snap.state as RecorderState) !== "starting") {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = media;
    chunks = [];
    rec = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      recorder = make(media);
    } catch (e) {
      releaseMic();
      tellRecorder(false);
      return set({ state: "idle", message: `This browser refused to record: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    // The recorder failing is not the recording failing: what it captured is kept.
    recorder.onerror = (e) => {
      const seconds = elapsed();
      const kept = new Blob(chunks, { type: typeOf() });
      diagnose("recorder-error", { name: e?.error?.name ?? "", message: e?.error?.message ?? "", seconds, bytes: kept.size, held: snap.held });
      stopTimers();
      releaseMic();
      tellRecorder(false);
      if (kept.size) {
        pending = kept;
        set({ state: "retry", message: `The recorder stopped with an error after ${mmss(seconds)}. What it captured is kept: Send again.${snap.held ? ` ${kb(snap.held)} of it is already stored.` : ""}`, error: true });
      } else set({ state: "idle", message: "The recorder stopped before it captured anything. Nothing was sent.", error: true });
    };
    recorder.start(1000);
    startedAt = Date.now();
    partTimer = setInterval(() => void sendPart(), partEvery);
    beatTimer = setInterval(() => tellRecorder(true), beatEvery);
    clock = setInterval(() => set({ seconds: elapsed() }), 500);
    set({ state: "recording", seconds: 0, message: "" });
  }

  /** Stop, and take what the recorder has even if it never reports stopped. */
  function lastBlob(): Promise<Blob> {
    return new Promise((done) => {
      let settled = false;
      const give = () => {
        if (settled) return;
        settled = true;
        const whole = (recorder as (RecorderLike & { whole?: Blob }) | null)?.whole;
        done(whole ?? new Blob(chunks, { type: typeOf() }));
      };
      const guard = setTimeout(give, 3000);
      if (!recorder) return give();
      recorder.onstop = () => {
        clearTimeout(guard);
        give();
      };
      try {
        recorder.stop();
      } catch {
        clearTimeout(guard);
        give();
      }
    });
  }

  async function send(blob: Blob): Promise<void> {
    set({ state: "sending", message: `Sending ${kb(blob.size)}, then transcribing and storing…`, error: false });
    try {
      const r = await doFetch(`${base}takes?${query()}`, { method: "POST", headers: { "content-type": (blob.type || "audio/mp4").split(";")[0] }, body: blob });
      const answer = (await r.json()) as { success?: boolean; error?: string; take?: string; english?: string; transcriptError?: string; presence?: CompanionPresence; listening?: boolean };
      if (!answer.success || !answer.take) throw new Error(answer.error || `HTTP ${r.status}`);
      pending = null;
      rec = "";
      const presence = answer.presence ?? { state: answer.listening ? "listening" : "away" };
      const told = answer.transcriptError
        ? ` Transcription failed, so no session wakes yet: ${answer.transcriptError}`
        : ({ listening: " The session listening there will hear it.", answering: " Mia is answering an earlier take; she hears this one next.", answered: " The session hears it as soon as it listens again." } as Record<string, string>)[presence.state]
          ?? " No session is listening yet; the take waits, and her reply comes here when one answers.";
      set({ state: "idle", seconds: 0, held: 0, message: `Take ${answer.take} is in the episode.${told}`, error: !!answer.transcriptError, stored: { take: answer.take, english: answer.english ?? "", transcriptError: answer.transcriptError, presence } });
      if (!answer.transcriptError) opts.onStored?.(answer.take);
    } catch (e) {
      pending = blob;
      diagnose("send-failed", { message: e instanceof Error ? e.message : String(e), bytes: blob.size, held: snap.held });
      set({ state: "retry", message: `Not stored: ${e instanceof Error ? e.message : String(e)}. Your recording is kept — Send again.${snap.held ? ` ${kb(snap.held)} of it is already stored, and becomes a take by itself if you leave.` : ""}`, error: true });
    }
  }

  async function stop(): Promise<void> {
    if (snap.state !== "recording") return;
    const seconds = elapsed();
    stopTimers();
    tellRecorder(false);
    set({ state: "sending", seconds });
    const blob = await lastBlob();
    releaseMic();
    if (!blob.size) {
      diagnose("empty-at-stop", { seconds, held: snap.held });
      return set({
        state: "idle",
        message: snap.held ? `The recorder handed back nothing at Stop, but ${kb(snap.held)} is stored; it becomes a take within a few minutes.` : "Nothing was recorded. Try again.",
        error: true,
      });
    }
    await send(blob);
  }

  async function resend(): Promise<void> {
    if (snap.state === "retry" && pending) await send(pending);
  }

  return {
    getSnapshot: () => snap,
    async press() {
      if (snap.state === "recording") return stop();
      if (snap.state === "retry" && pending) return resend();
      return start();
    },
    start,
    stop,
    resend,
    destroy() {
      stopTimers();
      if (snap.state === "recording" || snap.state === "starting") tellRecorder(false);
      try {
        recorder?.stop();
      } catch {
        // not recording
      }
      releaseMic();
    },
  };
}

// ─── The conversation ────────────────────────────────────────────────

export interface ThreadSnapshot {
  episode: string | null;
  items: CompanionItem[];
  presence: CompanionPresence | null;
  /** The take waiting for its reply, and since when. */
  waiting: { take: string; since: number } | null;
  error: string | null;
}

export interface CompanionThreadOptions {
  base: string;
  onChange?: (s: ThreadSnapshot) => void;
  /** A reply that arrived while this page was open — not one already there when it opened. */
  onReply?: (reply: CompanionReply) => void;
  everyMs?: number;
  waitEveryMs?: number;
  waitForMs?: number;
  fetch?: typeof fetch;
}

export interface CompanionThread {
  getSnapshot(): ThreadSnapshot;
  setEpisode(episode: string | null): void;
  refresh(): Promise<void>;
  /** Poll faster until a reply to `take` arrives (15 minutes at most). */
  waitFor(take: string): void;
  feedback(id: string, value: "up" | "down" | ""): Promise<void>;
  destroy(): void;
}

export function createCompanionThread(opts: CompanionThreadOptions): CompanionThread {
  const base = opts.base.endsWith("/") ? opts.base : `${opts.base}/`;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const every = opts.everyMs ?? 10_000;
  const waitEvery = opts.waitEveryMs ?? 4_000;
  const waitFor = opts.waitForMs ?? 15 * 60_000;
  let snap: ThreadSnapshot = { episode: null, items: [], presence: null, waiting: null, error: null };
  const seen = new Set<string>();
  let primed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let fast: ReturnType<typeof setInterval> | null = null;
  let key = "";
  let generation = 0;
  const set = (patch: Partial<ThreadSnapshot>) => {
    snap = { ...snap, ...patch };
    opts.onChange?.(snap);
  };

  async function refresh(): Promise<void> {
    const episode = snap.episode;
    if (!episode) return;
    const mine = generation;
    try {
      const r = await doFetch(`${base}thread?episode=${encodeURIComponent(episode)}`, { cache: "no-store" });
      const answer = (await r.json()) as { success?: boolean; error?: string; items?: CompanionItem[]; presence?: CompanionPresence };
      if (mine !== generation) return;
      if (!answer.success) return set({ error: answer.error ?? `HTTP ${r.status}` });
      const items = answer.items ?? [];
      const nextKey = items.map((i) => (i.kind === "reply" ? `${i.id}:${i.audio ? 1 : 0}:${i.feedback ?? ""}` : `${i.take}:${i.text.length}`)).join(",") + `|${answer.presence?.state}`;
      const fresh = items.filter((i): i is CompanionReply => i.kind === "reply" && !seen.has(i.id));
      for (const r2 of fresh) seen.add(r2.id);
      if (nextKey !== key || snap.error) {
        key = nextKey;
        set({ items, presence: answer.presence ?? null, error: null });
      }
      // The first look takes what is there as heard; only what arrives after is announced.
      if (primed) for (const reply of fresh) opts.onReply?.(reply);
      primed = true;
      const w = snap.waiting;
      if (w && (items.some((i) => i.kind === "reply" && i.take === w.take) || Date.now() - w.since > waitFor)) {
        if (fast) clearInterval(fast);
        fast = null;
        set({ waiting: null });
      }
    } catch (e) {
      if (mine === generation) set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  function arm(): void {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void refresh();
    }, every);
  }
  const onVisible = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  return {
    getSnapshot: () => snap,
    setEpisode(episode) {
      if (episode === snap.episode) return;
      generation += 1;
      seen.clear();
      primed = false;
      key = "";
      if (fast) clearInterval(fast);
      fast = null;
      set({ episode, items: [], presence: null, waiting: null, error: null });
      if (episode) {
        arm();
        void refresh();
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    refresh,
    waitFor(take) {
      set({ waiting: { take, since: Date.now() } });
      if (fast) clearInterval(fast);
      fast = setInterval(() => void refresh(), waitEvery);
      void refresh();
    },
    async feedback(id, value) {
      await doFetch(`${base}replies/${id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
      key = "";
      await refresh();
    },
    destroy() {
      generation += 1;
      for (const t of [timer, fast]) if (t) clearInterval(t);
      timer = fast = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
