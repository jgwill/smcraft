"use client";

/**
 * Talking with Mia from the canvas (Spec 84).
 *
 * The Mia episode companion's phone page, in a corner of the designer: the person
 * presses Record and speaks about what is on the canvas; the take is sent to the
 * episode as it is recorded (a backup part every 10 s) and whole on Stop, with what the
 * canvas showed — the drawing, the element in focus, the marks waiting on an agent. The
 * session listening in that episode replies; a reply with steps plays as a tour on this
 * stage, each step's words in Mia's voice while that step's drawing is open and its
 * elements are lit.
 *
 * The phone page's rules hold here:
 * - nothing plays while the person records or a take is being sent; a reply that arrives
 *   then waits, and plays once the take is sent;
 * - a reply that arrives while another plays waits for it to end;
 * - a reply already in the thread when the page opened is shown, not played;
 * - once the person presses ▶ or ■, the waiting sequence is over: each reply plays when
 *   they choose it.
 *
 * The conversation holds the person's marks on the episode's drawings too (the service
 * reads their sidecars): each mark with its thread, and tapping one opens its drawing at
 * that mark's thread. On a phone the closed dock is the bar at the top of the sheet at the
 * bottom of the board, and the open conversation takes the caption's place in that sheet;
 * it and a mark's card take turns.
 *
 * Everything reaches the service through `/api/companion/` (this designer's proxy to
 * `STATELOOM_COMPANION_URL`); a reply is never posted from here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  browserVoice,
  createCompanionThread,
  createTakeRecorder,
  replyTour,
  takeContext,
  type CompanionReply,
  type CompanionThread,
  type RecorderSnapshot,
  type TakeRecorder,
  type ThreadSnapshot,
} from "@miadi/stateloom-react";
import { CompanionDock, type DockMark } from "@miadi/stateloom-canvas";
import { marksWaitingOn, readMarksFile } from "@miadi/stateloom-protocol";
import { requestedDoc } from "@/lib/docParam";
import { openInSystem, urlParam } from "@/lib/systemParam";
import { requestMark } from "@/lib/markRequest";
import type { StageValue } from "./StageProvider";

const BASE = "/api/companion/";
const WHO = "Mia";
const AUTOPLAY_KEY = "stateloom.companion.autoplay";
const EPISODE_KEY = "stateloom.companion.episode";
const EPISODE_NAME = /^\d{4}-\d{2}-\d{2}-episode-\d+-[a-z0-9-]+$/;

/** The episode a chronicle drawing belongs to: `<root>/<episode>/diagrams/<file>`. */
export function episodeOf(doc: string | null | undefined): string | null {
  const m = doc?.match(/(?:^|\/)(\d{4}-\d{2}-\d{2}-episode-\d+-[a-z0-9-]+)\/diagrams\/[^/]+$/);
  return m ? m[1] : null;
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice holds for this page only.
  }
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const busy = (s: RecorderSnapshot["state"]) => s === "starting" || s === "recording" || s === "sending";

const IDLE: RecorderSnapshot = { state: "idle", seconds: 0, held: 0, message: "", error: false, stored: null };
const EMPTY: ThreadSnapshot = { episode: null, items: [], presence: null, waiting: null, error: null };

export default function CompanionLayer({ stage, defaultEpisode }: { stage: StageValue; defaultEpisode: string | null }) {
  // The dock opens closed on every visit: the board comes first, the conversation is one tap away.
  const [open, setOpenState] = useState(false);
  const [autoplay, setAutoplayState] = useState(() => readLocal(AUTOPLAY_KEY) !== "0");
  const [episode, setEpisodeState] = useState<string | null>(() => {
    const asked = urlParam("episode");
    // The episode this browser last spoke in comes before a server's default, as on the phone page.
    const remembered = readLocal(EPISODE_KEY);
    return (
      (asked && EPISODE_NAME.test(asked) ? asked : null) ??
      episodeOf(requestedDoc()) ??
      (remembered && EPISODE_NAME.test(remembered) ? remembered : null) ??
      defaultEpisode
    );
  });
  const [episodes, setEpisodes] = useState<{ path: string; number: number }[]>([]);
  const [rec, setRec] = useState<RecorderSnapshot>(IDLE);
  const [thread, setThread] = useState<ThreadSnapshot>(EMPTY);
  const [playing, setPlayingState] = useState<string | null>(null);
  const [unheard, setUnheard] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // What the long-lived recorder and thread read when they call back.
  const stageRef = useRef(stage);
  const episodeRef = useRef(episode);
  const autoplayRef = useRef(autoplay);
  useEffect(() => {
    stageRef.current = stage;
    episodeRef.current = episode;
    autoplayRef.current = autoplay;
  });
  const recRef = useRef<RecorderSnapshot>(IDLE);
  const playingRef = useRef<string | null>(null);
  const queue = useRef<CompanionReply[]>([]);
  /** The reply stopped because the person pressed Record: its sequence goes on after the take. */
  const heldForTake = useRef(false);
  const waitingMarks = useRef<string[]>([]);
  const recorder = useRef<TakeRecorder | null>(null);
  const threadRef = useRef<CompanionThread | null>(null);

  // Her voice: the reply's own recordings; a step without one is read, never spoken in
  // a voice that is not hers.
  const voice = useMemo(() => browserVoice({ recordings: true, speech: false }), []);

  const setPlaying = (id: string | null) => {
    playingRef.current = id;
    setPlayingState(id);
  };

  /** The latest `play`, for the calls that outlive a render (a queued reply, a callback). */
  const playRef = useRef<(reply: CompanionReply, from?: number) => Promise<void>>(async () => {});
  const play = useCallback(
    async (reply: CompanionReply, from = 0) => {
      setPlaying(reply.id);
      setUnheard((u) => u.filter((id) => id !== reply.id));
      // A reply that walks the diagram needs the board. On a phone the dock folds to its
      // button; on a wider screen it stays beside the board and follows the walk step by step.
      if (reply.steps?.length && window.matchMedia("(max-width: 767px)").matches) setOpenState(false);
      const more = queue.current.length;
      setNotice(more ? `${more} more of ${WHO}'s replies wait after this one.` : null);
      const done = await stageRef.current.present(replyTour(reply, BASE, WHO), { voice, origin: WHO, from });
      // Another reply took the stage from this one: that play owns what follows.
      if (playingRef.current !== reply.id) return;
      setPlaying(null);
      if (heldForTake.current) return;
      if (!done) {
        // Stopped, or the stage was given to something else: the sequence is over.
        queue.current = [];
        return;
      }
      const next = queue.current.shift();
      if (next && !busy(recRef.current.state)) void playRef.current(next);
      else if (next) queue.current.unshift(next);
    },
    [voice],
  );
  useEffect(() => {
    playRef.current = play;
  }, [play]);

  const arrived = useCallback((reply: CompanionReply) => {
    const id = reply.id;
    if (!autoplayRef.current) {
      setUnheard((u) => (u.includes(id) ? u : [...u, id]));
      return;
    }
    if (busy(recRef.current.state) || playingRef.current) {
      setUnheard((u) => (u.includes(id) ? u : [...u, id]));
      if (!queue.current.some((r) => r.id === id)) queue.current.push(reply);
      setNotice(
        busy(recRef.current.state)
          ? `${WHO} replied at ${when(reply.at)}. Her voice waits until you have sent your take.`
          : `${WHO} replied again at ${when(reply.at)}. It plays when this one ends.`,
      );
      return;
    }
    void playRef.current(reply);
  }, []);

  // The recorder and the conversation live as long as the page.
  useEffect(() => {
    const t = createCompanionThread({ base: BASE, onChange: setThread, onReply: arrived });
    const r = createTakeRecorder({
      base: BASE,
      episode: () => episodeRef.current,
      context: () => {
        // A take spoken while a step is on the board carries that step: what was lit and said.
        const on = stageRef.current.shown;
        const step = on
          ? {
              ...(on.title || on.step.title ? { title: [on.title, on.step.title].filter(Boolean).join(" · ") } : {}),
              say: on.step.say.slice(0, 400),
              ...(on.index !== null && on.count !== null ? { index: on.index, count: on.count } : {}),
              ...(on.origin ? { by: on.origin } : {}),
            }
          : null;
        return takeContext(stageRef.current.lastReport(), {
          ...(waitingMarks.current.length ? { marks: waitingMarks.current } : {}),
          ...(on?.step.spotlight?.length ? { spotlight: on.step.spotlight } : {}),
          ...(step ? { step } : {}),
        });
      },
      onChange: (s) => {
        const was = recRef.current.state;
        recRef.current = s;
        setRec(s);
        // Once a take is sent (or the microphone closed), what waited for it plays in order.
        if (!busy(was) || busy(s.state)) return;
        heldForTake.current = false;
        if (!autoplayRef.current || playingRef.current) return;
        const next = queue.current.shift();
        if (next) void playRef.current(next);
        else setNotice(null);
      },
      onStored: (take) => t.waitFor(take),
    });
    threadRef.current = t;
    recorder.current = r;
    recRef.current = r.getSnapshot();
    setRec(r.getSnapshot());
    return () => {
      r.destroy();
      t.destroy();
      threadRef.current = null;
      recorder.current = null;
    };
  }, [arrived]);

  useEffect(() => {
    threadRef.current?.setEpisode(episode);
  }, [episode]);

  // The service's own default episode, when nothing else named one; and whether it answers.
  useEffect(() => {
    let live = true;
    fetch(`${BASE}health`, { cache: "no-store" })
      .then((r) => r.json())
      .then((a: { success?: boolean; error?: string; defaultEpisode?: string | null }) => {
        if (!live) return;
        if (!a.success) return setProblem(`The companion does not answer: ${a.error ?? "no reason given"}.`);
        setProblem(null);
        if (a.defaultEpisode) setEpisodeState((e) => e ?? a.defaultEpisode ?? null);
      })
      .catch((e) => live && setProblem(`The companion does not answer: ${e instanceof Error ? e.message : String(e)}.`));
    return () => {
      live = false;
    };
  }, []);

  // The episodes to choose from, read when the dock first opens.
  useEffect(() => {
    if (!open || episodes.length) return;
    let live = true;
    fetch(`${BASE}episodes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((a: { success?: boolean; episodes?: { path: string; number: number }[] }) => {
        if (live && a.success && a.episodes) setEpisodes(a.episodes);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, episodes.length]);

  // The marks on the open drawing that wait on an agent travel with the take.
  const marksDoc = useRef<string | null>(null);
  const refreshMarks = useCallback(async (force = false) => {
    const doc = stageRef.current.lastReport()?.doc ?? null;
    if (!force && doc === marksDoc.current) return;
    marksDoc.current = doc;
    if (!doc) {
      waitingMarks.current = [];
      return;
    }
    try {
      const r = await fetch(`/api/marks?doc=${encodeURIComponent(doc)}`, { cache: "no-store" });
      const body = (await r.json()) as { marks?: unknown };
      waitingMarks.current = marksWaitingOn(readMarksFile(body, doc).marks, "agent").map((m) => m.id);
    } catch {
      waitingMarks.current = [];
    }
  }, []);
  useEffect(() => {
    void refreshMarks(true);
    const off = stageRef.current.onMarks(() => void refreshMarks(true));
    const t = setInterval(() => void refreshMarks(), 3000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [refreshMarks]);

  // The clock on a take waiting for its reply.
  useEffect(() => {
    if (!thread.waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [thread.waiting]);

  const onRecord = useCallback(() => {
    const r = recorder.current;
    if (!r) return;
    if (!busy(recRef.current.state) && recRef.current.state !== "retry" && playingRef.current) {
      // Her voice and his microphone do not share the room: she stops, and what waited
      // after her plays once his take is sent.
      heldForTake.current = true;
      stageRef.current.stop();
    }
    void r.press();
  }, []);

  const onPlay = useCallback((id: string, from?: number) => {
    const reply = threadRef.current?.getSnapshot().items.find((i): i is CompanionReply => i.kind === "reply" && i.id === id);
    if (!reply) return;
    if (busy(recRef.current.state)) {
      setNotice(`Send your take first. Then press play to hear ${WHO}.`);
      return;
    }
    queue.current = [];
    heldForTake.current = false;
    void playRef.current(reply, from);
  }, []);

  const onStop = useCallback(() => {
    queue.current = [];
    heldForTake.current = false;
    stageRef.current.stop();
  }, []);

  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (v) void refreshMarks(true);
  };
  const setAutoplay = (v: boolean) => {
    setAutoplayState(v);
    writeLocal(AUTOPLAY_KEY, v ? "1" : "0");
    if (!v) queue.current = [];
  };
  const onEpisode = (path: string) => {
    if (!EPISODE_NAME.test(path) || path === episode) return;
    queue.current = [];
    setUnheard([]);
    setNotice(null);
    setEpisodeState(path);
    writeLocal(EPISODE_KEY, path);
  };

  const waiting = thread.waiting ? { take: thread.waiting.take, seconds: Math.max(0, Math.floor((now - thread.waiting.since) / 1000)) } : null;

  // ── The phone's sheet: the open conversation holds it in the caption's place ──
  const { narrow, sheet: sheetOwner, claimSheet, releaseSheet } = stage;
  useEffect(() => {
    if (open) claimSheet("talk");
    else releaseSheet("talk");
  }, [open, claimSheet, releaseSheet]);
  useEffect(() => () => releaseSheet("talk"), [releaseSheet]);
  // A mark's card took the sheet: the conversation folds to its bar.
  const [seenOwner, setSeenOwner] = useState(sheetOwner);
  if (seenOwner !== sheetOwner) {
    setSeenOwner(sheetOwner);
    if (narrow && sheetOwner === "card") setOpenState(false);
  }

  // A mark in the conversation: its drawing, at its thread.
  const onOpenMark = useCallback((mark: DockMark) => {
    if (window.matchMedia("(max-width: 767px)").matches) setOpenState(false);
    requestMark(mark.doc, mark.id);
    if (stageRef.current.board !== mark.doc) openInSystem({ doc: mark.doc, focus: null });
  }, []);

  const dock = (
      <CompanionDock
        open={open}
        onOpenChange={setOpen}
        variant={narrow ? "bar" : "fab"}
        onOpenMark={onOpenMark}
        who={WHO}
        episode={episode}
        episodes={episodes}
        onEpisode={onEpisode}
        presence={thread.presence}
        recorder={rec}
        onRecord={onRecord}
        items={thread.items}
        unheard={unheard}
        playing={playing}
        playingStep={playing && stage.shown?.origin === WHO ? stage.shown.index : null}
        onPlay={onPlay}
        onStop={onStop}
        onFeedback={(id, value) => {
          threadRef.current?.feedback(id, value).catch((e: unknown) => setProblem(`Your thumb was not kept: ${e instanceof Error ? e.message : String(e)}.`));
        }}
        autoplay={autoplay}
        onAutoplay={setAutoplay}
        waiting={waiting}
        notice={notice}
        error={problem ?? thread.error}
      />
  );
  if (narrow) {
    // The bar is the sheet's handle; the open conversation is its body.
    const slot = open ? stage.sheetBody : stage.sheetHandle;
    return slot ? createPortal(dock, slot) : null;
  }
  return <div className="stage-talk-host">{dock}</div>;
}
