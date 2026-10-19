/**
 * The stage session (Spec 83) against a stand-in client and hand-turned
 * timers: what a late canvas is shown, how a tour plays (read, or heard and
 * then a breath), how a live step pauses it, the agent's controls, carrying a
 * drawing forward across steps, and that a cancelled voice advances nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeClient, BridgeEvent, BridgeStatus } from "@miadi/stateloom-client";
import type { StageState, TourDefinition, TourStep } from "@miadi/stateloom-protocol";
import { createStageSession, type StageShown, type StageVoice } from "../stage.js";

function fakeClient(state: StageState = { stage: "default" }) {
  const handlers = new Map<BridgeEvent, Set<(a: unknown) => void>>();
  const sent: { kind: string; env: unknown }[] = [];
  let status: BridgeStatus = "disconnected";
  const fire = (ev: BridgeEvent, arg: unknown) => {
    for (const h of [...(handlers.get(ev) ?? [])]) h(arg);
  };
  const client = {
    on(ev: BridgeEvent, h: (a: unknown) => void) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
      return () => handlers.get(ev)!.delete(h);
    },
    async joinStage() {
      status = "connected";
      fire("status", status);
      return { selfId: "me", state };
    },
    leaveStage() {},
    emitContext(env: unknown) {
      sent.push({ kind: "context", env });
    },
    async emitMarks(env: unknown) {
      sent.push({ kind: "marks", env });
    },
    disconnect() {
      status = "disconnected";
    },
    get status() {
      return status;
    },
  } as unknown as BridgeClient;
  return { client, fire, sent };
}

function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t: ReturnType<typeof setTimeout>) => void timers.delete(t as unknown as number),
    /** Move time on, firing what falls due, in order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

const tour: TourDefinition = {
  settings: { namespace: "n", name: "Walk" },
  steps: [
    { doc: "/d/a.sqdf.json", system: "/d/s.sysdf.json", focus: "message:1", say: "one", holdMs: 1000 },
    { spotlight: ["message:2"], say: "two", holdMs: 1000 },
    { doc: "/d/b.smdf.json", focus: "state:X", say: "three", holdMs: 1000 },
  ],
};

const tick = () => new Promise((r) => setImmediate(r));

test("a late canvas is shown what is on stage, paused", async () => {
  const { client } = fakeClient({ stage: "default", tour: { stage: "default", tour, from: 1, origin: "mia" } });
  const shown: (StageShown | null)[] = [];
  const s = createStageSession({ url: "x", client, onShow: (v) => shown.push(v) });
  s.connect();
  await tick();
  const snap = s.getSnapshot();
  assert.equal(snap.playing, false);
  assert.equal(snap.index, 1);
  assert.equal(snap.shown?.step.say, "two");
  assert.equal(snap.shown?.step.doc, "/d/a.sqdf.json", "the drawing carries forward");
  assert.equal(snap.shown?.step.system, "/d/s.sysdf.json", "and the system with it");
  assert.equal(snap.shown?.title, "Walk");
  assert.equal(shown.length, 1);
  assert.equal(snap.shown?.caught, true, "a catch-up says so, so a page opened on a drawing can keep it");
});

test("play on a caught-up step shows it for real; a step sent now is never marked caught", async () => {
  const { client, fire } = fakeClient({ stage: "default", tour: { stage: "default", tour, from: 0, origin: "mia" } });
  const shown: (StageShown | null)[] = [];
  const t = clock();
  const s = createStageSession({ url: "x", client, onShow: (v) => shown.push(v), setTimer: t.setTimer, clearTimer: t.clearTimer });
  s.connect();
  await tick();
  assert.equal(shown.at(-1)?.caught, true);
  s.play();
  assert.equal(shown.length, 2, "the same step is shown again, this time to open its drawing");
  assert.equal(shown.at(-1)?.caught, undefined);
  assert.equal(shown.at(-1)?.index, 0);
  fire("stage-step", { stage: "default", step: { say: "now" }, origin: "mia", at: "" });
  assert.equal(shown.at(-1)?.caught, undefined);
  assert.equal(s.getSnapshot().ownVoice, false);
});

test("a tour plays by reading time, stops at its end, and play starts it over", async () => {
  const { client, fire } = fakeClient();
  const c = clock();
  const s = createStageSession({ url: "x", client, setTimer: c.setTimer, clearTimer: c.clearTimer });
  s.connect();
  await tick();
  fire("stage-load", { stage: "default", tour, origin: "mia" });
  assert.equal(s.getSnapshot().playing, true);
  assert.equal(s.getSnapshot().index, 0);
  c.advance(999);
  assert.equal(s.getSnapshot().index, 0);
  c.advance(1);
  assert.equal(s.getSnapshot().index, 1);
  c.advance(2000);
  assert.equal(s.getSnapshot().index, 2);
  assert.equal(s.getSnapshot().shown?.step.doc, "/d/b.smdf.json");
  c.advance(1000);
  assert.equal(s.getSnapshot().playing, false, "the last step ends the play");
  assert.equal(s.getSnapshot().index, 2);
  s.play();
  assert.equal(s.getSnapshot().index, 0, "play from the end starts over");
  assert.equal(s.getSnapshot().playing, true);
});

test("a live step pauses the tour under it; dismissing returns to the tour, paused", async () => {
  const { client, fire } = fakeClient();
  const c = clock();
  const s = createStageSession({ url: "x", client, setTimer: c.setTimer, clearTimer: c.clearTimer });
  s.connect();
  await tick();
  fire("stage-load", { stage: "default", tour, origin: "mia" });
  fire("stage-step", { stage: "default", step: { focus: "state:Y", say: "look here" }, origin: "mia" });
  const snap = s.getSnapshot();
  assert.equal(snap.playing, false);
  assert.equal(snap.shown?.index, null);
  assert.equal(snap.shown?.step.say, "look here");
  c.advance(10000);
  assert.equal(s.getSnapshot().shown?.step.say, "look here", "a live step stays until something else comes");
  s.dismiss();
  assert.equal(s.getSnapshot().shown?.index, 0);
  assert.equal(s.getSnapshot().playing, false);
  fire("stage-step", { stage: "other", step: { say: "not ours" }, origin: "x" });
  assert.equal(s.getSnapshot().shown?.index, 0, "another stage's step is not shown");
});

test("the agent's controls are the person's buttons", async () => {
  const { client, fire } = fakeClient();
  const c = clock();
  const s = createStageSession({ url: "x", client, setTimer: c.setTimer, clearTimer: c.clearTimer });
  s.connect();
  await tick();
  fire("stage-load", { stage: "default", tour, autoplay: false, origin: "mia" });
  assert.equal(s.getSnapshot().playing, false);
  fire("stage-control", { stage: "default", action: "goto", index: 2, origin: "mia" });
  assert.equal(s.getSnapshot().index, 2);
  fire("stage-control", { stage: "default", action: "prev", origin: "mia" });
  assert.equal(s.getSnapshot().index, 1);
  fire("stage-control", { stage: "default", action: "play", origin: "mia" });
  assert.equal(s.getSnapshot().playing, true);
  fire("stage-control", { stage: "default", action: "pause", origin: "mia" });
  c.advance(5000);
  assert.equal(s.getSnapshot().index, 1, "paused stays");
  fire("stage-control", { stage: "default", action: "stop", origin: "mia" });
  assert.equal(s.getSnapshot().tour, null);
  assert.equal(s.getSnapshot().shown, null);
});

test("with a voice, a step is heard, then a breath, then the next; a cancelled voice advances nothing", async () => {
  const { client, fire } = fakeClient();
  const c = clock();
  const pending: { step: TourStep; resolve: () => void }[] = [];
  let cancels = 0;
  const voice: StageVoice = {
    speak: (step) => new Promise<void>((resolve) => pending.push({ step, resolve })),
    cancel: () => {
      cancels++;
      // A real voice answers its promise when cancelled.
      pending.splice(0).forEach((p) => p.resolve());
    },
  };
  const s = createStageSession({ url: "x", client, voice, gapMs: 500, setTimer: c.setTimer, clearTimer: c.clearTimer });
  s.connect();
  await tick();
  fire("stage-load", { stage: "default", tour, origin: "mia" });
  assert.equal(s.getSnapshot().speaking, true);
  assert.equal(pending[0].step.say, "one");
  c.advance(5000);
  assert.equal(s.getSnapshot().index, 0, "reading time does not apply while heard");
  pending.shift()!.resolve();
  await tick();
  assert.equal(s.getSnapshot().speaking, false);
  c.advance(499);
  assert.equal(s.getSnapshot().index, 0);
  c.advance(1);
  assert.equal(s.getSnapshot().index, 1);

  // Pressing play on the step already shown starts it heard again; the first
  // voice is cancelled, and its late answer must not move the tour on.
  s.play();
  assert.ok(cancels > 0);
  await tick();
  c.advance(2000);
  assert.equal(s.getSnapshot().index, 1, "a cancelled voice's answer advanced nothing");
  s.pause();
  await tick();
  c.advance(5000);
  assert.equal(s.getSnapshot().index, 1);
});

test("context carries the stage and where the tour stands; marks carry the stage", async () => {
  const { client, fire, sent } = fakeClient();
  const s = createStageSession({ url: "x", client, stage: "trading" });
  s.connect();
  await tick();
  fire("stage-load", { stage: "trading", tour, from: 2, autoplay: false, origin: "mia" });
  s.sendContext({ doc: "/d/b.smdf.json", kind: "machine", focus: "state:X", who: "Guillaume" });
  s.sendMarks({ docId: "/d/b.smdf.json", marks: [], change: { action: "add", id: "m-1" } });
  await tick();
  const ctx = sent.find((x) => x.kind === "context")!.env as { stage: string; tour: { index: number; count: number; title: string } };
  assert.equal(ctx.stage, "trading");
  assert.deepEqual({ index: ctx.tour.index, count: ctx.tour.count, title: ctx.tour.title }, { index: 2, count: 3, title: "Walk" });
  assert.equal((sent.find((x) => x.kind === "marks")!.env as { stage: string }).stage, "trading");
});

test("present plays a tour from the page in its own voice, and answers when it ends or is replaced", async () => {
  const { client, fire } = fakeClient();
  const c = clock();
  const pageSpoke: string[] = [];
  const ownSpoke: string[] = [];
  const pending: (() => void)[] = [];
  const pageVoice: StageVoice = { speak: async (s) => void pageSpoke.push(s.say), cancel: () => {} };
  const recordings: StageVoice = {
    speak: (s) => new Promise<void>((resolve) => {
      ownSpoke.push(s.audio ?? "");
      pending.push(resolve);
    }),
    cancel: () => pending.splice(0).forEach((r) => r()),
  };
  const s = createStageSession({ url: "x", client, voice: pageVoice, gapMs: 100, setTimer: c.setTimer, clearTimer: c.clearTimer });
  s.connect();
  await tick();
  const reply: TourDefinition = {
    settings: { namespace: "companion", name: "Mia · 14:02" },
    steps: [
      { doc: "/d/a.smdf.json", spotlight: ["state:A"], say: "one", audio: "/a/0.mp3" },
      { say: "two", audio: "/a/1.mp3" },
    ],
  };
  const done = s.present(reply, { voice: recordings, origin: "Mia" });
  assert.equal(s.getSnapshot().shown?.origin, "Mia");
  assert.equal(s.getSnapshot().shown?.step.doc, "/d/a.smdf.json");
  assert.deepEqual(ownSpoke, ["/a/0.mp3"], "the tour's own voice, not the page's");
  assert.deepEqual(pageSpoke, []);
  pending.shift()!();
  await tick();
  c.advance(100);
  assert.equal(s.getSnapshot().index, 1);
  assert.equal(s.getSnapshot().shown?.step.doc, "/d/a.smdf.json", "the drawing carries forward");
  pending.shift()!();
  await tick();
  c.advance(100);
  assert.equal(await done, true, "played to its end");

  // After the tour, the page's own voice is back.
  fire("stage-step", { stage: "default", step: { say: "live" }, origin: "agent" });
  await tick();
  assert.deepEqual(pageSpoke, ["live"]);

  const second = s.present(reply, { voice: recordings });
  const third = s.present(reply, { voice: recordings });
  assert.equal(await second, false, "a tour replaced by another answers false");
  s.stop();
  assert.equal(await third, false, "a stopped tour answers false");
  assert.equal(await s.present({ settings: { namespace: "n", name: "empty" }, steps: [] }), false);
});
