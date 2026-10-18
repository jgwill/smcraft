/**
 * The stage session (Spec 83) — the unit-testable core beneath `useStage`.
 *
 * A canvas joins a stage and is shown things: a live step while an agent
 * talks, or a whole tour it plays with its own controls. This object holds
 * what is on stage and plays it:
 *
 *   - `stage-step`    a live step. A tour that was playing pauses under it.
 *   - `stage-load`    a tour, at a step, playing unless the agent said not to.
 *   - `stage-control` an agent's play / pause / next / prev / goto / stop —
 *                     the same calls the person's own buttons make.
 *
 * Playing means: show the step, let it be heard (the host's voice, when it has
 * one turned on) or read (`stepHoldMs`), take a breath, show the next one. The
 * host decides what "show" means — open the drawing, focus, fit, light — in
 * `onShow`; this core never touches a DOM. A step shown twice is shown twice:
 * `nonce` moves every time.
 *
 * It also carries the other direction: `sendContext` tells the agents on the
 * stage what the person is looking at, and `sendMarks` tells them (and the
 * drawing's room) that a mark was written.
 */
import {
  createBridgeClient,
  type BridgeClient,
  type BridgeClientOptions,
  type BridgeStatus,
} from "@miadi/stateloom-client";
import {
  DEFAULT_STAGE,
  isStageName,
  stepDocs,
  stepHoldMs,
  type MarksEnvelope,
  type StageContext,
  type StageControlEnvelope,
  type StageLoadEnvelope,
  type StageState,
  type StageStepEnvelope,
  type TourDefinition,
  type TourStep,
} from "@miadi/stateloom-protocol";

/** Something that can make a step heard. `speak` resolves when it is done. */
export interface StageVoice {
  speak(step: TourStep): Promise<void>;
  cancel(): void;
}

/** What is on stage now, as the host is asked to show it. */
export interface StageShown {
  /** With the drawing (and system) carried forward from earlier steps of a tour. */
  step: TourStep;
  /** Its place in the tour; null for a live step. */
  index: number | null;
  count: number | null;
  title?: string;
  origin?: string;
  tourPath?: string;
  /** Moves every time something is put on stage. */
  nonce: number;
}

export interface StageSnapshot {
  status: BridgeStatus;
  stage: string;
  shown: StageShown | null;
  tour: { def: TourDefinition; path?: string; origin?: string } | null;
  /** The tour's current step (0-based). */
  index: number;
  playing: boolean;
  speaking: boolean;
}

type Timer = ReturnType<typeof setTimeout>;

export interface StageSessionOptions {
  url: string;
  stage?: string;
  token?: string;
  /** How this canvas names itself on the hub. */
  name?: string;
  role?: BridgeClientOptions["role"];
  /** Put a step on screen. */
  onShow?: (shown: StageShown | null) => void;
  /** A drawing's marks changed (someone else wrote them). */
  onMarks?: (e: MarksEnvelope) => void;
  /** The voice steps are heard in; null or absent: they are read. */
  voice?: StageVoice | null;
  /** The breath after a spoken step before the next one. Default 900 ms. */
  gapMs?: number;
  /** For tests: a client already made. */
  client?: BridgeClient;
  /** For tests: timers. */
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

export interface StageSession {
  getSnapshot(): StageSnapshot;
  subscribe(cb: () => void): () => void;
  connect(): void;
  disconnect(): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  goto(index: number): void;
  /** Put the tour away and clear the stage. */
  stop(): void;
  /** Close a live step's caption (a tour stays loaded, paused). */
  dismiss(): void;
  setVoice(voice: StageVoice | null): void;
  /** Say what this canvas shows. The stage and the tour's position are added here. */
  sendContext(ctx: Omit<StageContext, "stage" | "at" | "tour">): void;
  /** Tell the drawing's room and this stage that its marks changed. Write the sidecar first. */
  sendMarks(env: Omit<MarksEnvelope, "origin" | "stage">): void;
}

export function createStageSession(opts: StageSessionOptions): StageSession {
  const stage = isStageName(opts.stage) ? opts.stage : DEFAULT_STAGE;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t));
  const gapMs = opts.gapMs ?? 900;
  const client: BridgeClient =
    opts.client ??
    createBridgeClient({
      url: opts.url,
      role: opts.role ?? "web",
      // A stage client never joins a document room; the option only names one.
      docId: `stage:${stage}`,
      name: opts.name ?? "web-stage",
      token: opts.token,
      autoResync: false,
    });
  let voice: StageVoice | null = opts.voice ?? null;

  let shown: StageShown | null = null;
  let tour: StageSnapshot["tour"] = null;
  let docs: (string | undefined)[] = [];
  let systems: (string | undefined)[] = [];
  let index = 0;
  let playing = false;
  let speaking = false;
  let nonce = 0;
  let timer: Timer | null = null;
  /** Moves whenever what is being heard is let go, so a cancelled voice's late answer advances nothing. */
  let dwellSeq = 0;
  /** The tour played to its last step: play starts it over. */
  let ended = false;
  let wanted = false;
  let joined = false;
  let joining = false;

  let snapshot: StageSnapshot = { status: client.status, stage, shown, tour, index, playing, speaking };
  const subscribers = new Set<() => void>();

  function commit(): void {
    snapshot = { status: client.status, stage, shown, tour, index, playing, speaking };
    for (const cb of [...subscribers]) cb();
  }

  function quiet(): void {
    dwellSeq += 1;
    if (timer) clearTimer(timer);
    timer = null;
    if (speaking) voice?.cancel();
    speaking = false;
  }

  /** Let the step on stage be heard or read, then — when `advance` — go on. */
  function dwell(step: TourStep, advance: boolean): void {
    quiet();
    const mine = ++dwellSeq;
    const after = (): void => {
      if (mine !== dwellSeq) return;
      if (speaking) {
        speaking = false;
        commit();
      }
      if (!advance || !playing) return;
      timer = setTimer(() => {
        timer = null;
        if (mine === dwellSeq && playing) next();
      }, voice ? gapMs : 0);
    };
    if (voice) {
      speaking = true;
      commit();
      voice.speak(step).then(after, after);
    } else if (advance) {
      timer = setTimer(() => {
        timer = null;
        after();
      }, stepHoldMs(step));
    }
  }

  function show(next: Omit<StageShown, "nonce"> | null, advance: boolean): void {
    nonce += 1;
    quiet();
    shown = next ? { ...next, nonce } : null;
    commit();
    opts.onShow?.(shown);
    if (shown && (voice || advance)) dwell(shown.step, advance);
  }

  function tourStep(i: number): Omit<StageShown, "nonce"> | null {
    if (!tour) return null;
    const step = tour.def.steps[i];
    if (!step) return null;
    const doc = step.doc ?? docs[i];
    const system = step.system ?? systems[i];
    return {
      step: { ...step, ...(doc ? { doc } : {}), ...(system ? { system } : {}) },
      index: i,
      count: tour.def.steps.length,
      title: tour.def.settings?.name,
      origin: tour.origin,
      tourPath: tour.path,
    };
  }

  function load(env: StageLoadEnvelope, autoplay: boolean): void {
    const steps = Array.isArray(env.tour?.steps) ? env.tour.steps : [];
    tour = { def: { ...env.tour, steps }, path: env.path, origin: env.origin };
    docs = stepDocs(tour.def);
    // A system carries forward the way a drawing does.
    let sys: string | undefined;
    systems = steps.map((s) => (sys = s.system ?? sys));
    index = Math.min(Math.max(0, env.from ?? 0), Math.max(0, steps.length - 1));
    ended = false;
    playing = autoplay && steps.length > 0;
    show(tourStep(index), playing);
  }

  function liveStep(env: StageStepEnvelope): void {
    playing = false;
    show({ step: env.step, index: null, count: null, title: env.title, origin: env.origin, tourPath: env.tour }, false);
  }

  function apply(state: StageState): void {
    // What was on stage when this canvas arrived, shown paused.
    if (state.tour) load(state.tour, false);
    if (state.step) liveStep(state.step);
  }

  function goto(i: number): void {
    if (!tour) return;
    const last = tour.def.steps.length - 1;
    if (last < 0) return;
    index = Math.min(Math.max(0, Math.floor(i)), last);
    ended = false;
    show(tourStep(index), playing);
  }

  function next(): void {
    if (!tour) return;
    if (index >= tour.def.steps.length - 1) {
      ended = playing || ended;
      playing = false;
      quiet();
      commit();
      return;
    }
    goto(index + 1);
  }

  function prev(): void {
    if (tour && index > 0) goto(index - 1);
  }

  function play(): void {
    if (!tour || !tour.def.steps.length) return;
    playing = true;
    // From the end, play starts the tour over.
    if (ended) {
      ended = false;
      index = 0;
    }
    if (shown?.index !== index) show(tourStep(index), true);
    else {
      commit();
      dwell(shown.step, true);
    }
  }

  function pause(): void {
    playing = false;
    quiet();
    commit();
  }

  function stop(): void {
    ended = false;
    tour = null;
    docs = [];
    systems = [];
    index = 0;
    playing = false;
    show(null, false);
  }

  function dismiss(): void {
    if (!shown) return;
    if (shown.index === null && tour) {
      // Back to where the tour was, paused.
      show(tourStep(index), false);
      return;
    }
    if (shown.index === null) show(null, false);
    else stop();
  }

  function control(env: StageControlEnvelope): void {
    switch (env.action) {
      case "play":
        return play();
      case "pause":
        return pause();
      case "next":
        return next();
      case "prev":
        return prev();
      case "goto":
        return goto(env.index ?? 0);
      case "stop":
        return stop();
    }
  }

  client.on("stage-step", (e) => {
    if (e?.stage === stage && e.step) liveStep(e);
  });
  client.on("stage-load", (e) => {
    if (e?.stage === stage && e.tour) load(e, e.autoplay !== false);
  });
  client.on("stage-control", (e) => {
    if (e?.stage === stage) control(e);
  });
  client.on("marks", (e) => opts.onMarks?.(e));

  function join(): void {
    if (joining) return;
    joining = true;
    client
      .joinStage(stage)
      .then(({ state }) => {
        joining = false;
        joined = true;
        // After a reconnect, a hub that kept the stage has nothing new for a
        // canvas already showing something; one that restarted has nothing at all.
        if (!shown && !tour) apply(state);
        commit();
      })
      .catch(() => {
        joining = false;
        commit();
      });
  }

  client.on("status", (s) => {
    if (s === "disconnected" || s === "error") joined = false;
    else if (s === "connected" && wanted && !joined) join();
    commit();
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    connect() {
      wanted = true;
      join();
    },
    disconnect() {
      wanted = false;
      quiet();
      client.leaveStage(stage);
      client.disconnect();
    },
    play,
    pause,
    next,
    prev,
    goto,
    stop,
    dismiss,
    setVoice(v) {
      quiet();
      voice = v;
      commit();
    },
    sendContext(ctx) {
      client.emitContext({
        ...ctx,
        stage,
        ...(tour ? { tour: { path: tour.path, title: tour.def.settings?.name, index, count: tour.def.steps.length, playing } } : {}),
      });
    },
    sendMarks(env) {
      void client.emitMarks({ ...env, stage }).catch(() => {});
    },
  };
}
