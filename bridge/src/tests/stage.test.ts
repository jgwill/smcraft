/**
 * The stage (Spec 83) at the hub: a stage is a room that is not a document.
 * Steps, tours and controls reach every canvas on it from a socket that never
 * joined; what is on screen is kept for a canvas that joins late; a canvas's
 * context reaches the agents listening, never its own sender; marks reach the
 * drawing's room and the stage named; `GET /stage/<name>` answers in JSON.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  EV,
  type MarksEnvelope,
  type StageContext,
  type StageControlEnvelope,
  type StageLoadEnvelope,
  type StageState,
  type StageStepEnvelope,
} from "@miadi/stateloom-protocol";
import { DEFAULT_STAGE_STEP_TTL_MS, stageStepTtlFromEnv, startBridge, type BridgeHandle } from "../index.js";

const connect = (url: string, token?: string): ClientSocket =>
  ioClient(url, { transports: ["websocket"], reconnection: false, forceNew: true, auth: { token } });

function waitEvent<T = unknown>(sock: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), ms);
    sock.once(event, (arg: unknown) => {
      clearTimeout(timer);
      resolve(arg as T);
    });
  });
}

const joinStage = (sock: ClientSocket, stage: string) =>
  new Promise<{ selfId?: string; state?: StageState; error?: { code: string } }>((resolve) => sock.emit(EV.STAGE_JOIN, { stage }, resolve));

const quiet = (ms = 150) => new Promise((r) => setTimeout(r, ms));

test("a step reaches the stage's canvases, is kept for a late one, and a stop clears it", async () => {
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  try {
    hub = await startBridge({ port: 0 });
    const canvas = connect(hub.url);
    const agent = connect(hub.url);
    const other = connect(hub.url);
    sockets.push(canvas, agent, other);
    const first = await joinStage(canvas, "trading");
    assert.deepEqual(first.state, { stage: "trading" });
    await joinStage(other, "elsewhere");

    let stray = false;
    other.on(EV.STAGE_STEP_OUT, () => (stray = true));
    const got = waitEvent<StageStepEnvelope>(canvas, EV.STAGE_STEP_OUT);
    agent.emit(EV.STAGE_STEP_IN, { stage: "trading", step: { doc: "/d/w.smdf.json", focus: "state:A", say: "here" }, origin: "mia" });
    const step = await got;
    assert.equal(step.step.focus, "state:A");
    assert.equal(step.origin, "mia");
    assert.ok(step.at, "the hub stamps when");
    await quiet();
    assert.equal(stray, false, "another stage does not hear it");

    const late = connect(hub.url);
    sockets.push(late);
    const joined = await joinStage(late, "trading");
    assert.equal(joined.state?.step?.step.say, "here", "a late canvas catches up");

    const res = await fetch(`${hub.url}/stage/trading`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as StageState;
    assert.equal(body.step?.step.focus, "state:A");

    const stopped = waitEvent<StageControlEnvelope>(canvas, EV.STAGE_CONTROL_OUT);
    agent.emit(EV.STAGE_CONTROL_IN, { stage: "trading", action: "stop", origin: "mia" });
    assert.equal((await stopped).action, "stop");
    const after = (await (await fetch(`${hub.url}/stage/trading`)).json()) as StageState;
    assert.equal(after.step, undefined);
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
  }
});

test("a live step leaves the stage for late joiners after its time; a tour stays until stopped", async () => {
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  let clock = 1_000_000;
  try {
    hub = await startBridge({ port: 0, now: () => clock, stepTtlMs: 10 * 60 * 1000 });
    const agent = connect(hub.url);
    const canvas = connect(hub.url);
    sockets.push(agent, canvas);
    await joinStage(canvas, "default");
    const got = waitEvent<StageStepEnvelope>(canvas, EV.STAGE_STEP_OUT);
    agent.emit(EV.STAGE_STEP_IN, { stage: "default", step: { doc: "/d/w.smdf.json", spotlight: ["event:Upload"], say: "where YouTube comes in" }, origin: "mia" });
    await got;

    clock += 9 * 60 * 1000;
    const early = connect(hub.url);
    sockets.push(early);
    assert.equal((await joinStage(early, "default")).state?.step?.step.say, "where YouTube comes in", "within its time a late canvas catches up");

    clock += 60 * 1000;
    const late = connect(hub.url);
    sockets.push(late);
    assert.equal((await joinStage(late, "default")).state?.step, undefined, "past its time the join ack holds no step");
    const body = (await (await fetch(`${hub.url}/stage/default`)).json()) as StageState;
    assert.equal(body.step, undefined, "nor does GET /stage/<name>");

    const loaded = waitEvent<StageLoadEnvelope>(canvas, EV.STAGE_LOAD_OUT);
    agent.emit(EV.STAGE_LOAD_IN, { stage: "default", tour: { settings: { namespace: "t", name: "walk" }, steps: [{ say: "a" }] }, origin: "mia" });
    await loaded;
    clock += 24 * 60 * 60 * 1000;
    const tomorrow = connect(hub.url);
    sockets.push(tomorrow);
    assert.equal((await joinStage(tomorrow, "default")).state?.tour?.tour.settings.name, "walk", "a tour stays until stopped");
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
  }
});

test("a step's time comes from STATELOOM_STAGE_STEP_TTL_MS, and 0 keeps it until stopped", async () => {
  assert.equal(stageStepTtlFromEnv({ STATELOOM_STAGE_STEP_TTL_MS: "30000" }), 30000);
  assert.equal(stageStepTtlFromEnv({ SMCRAFT_STAGE_STEP_TTL_MS: "0" }), 0);
  assert.equal(stageStepTtlFromEnv({ STATELOOM_STAGE_STEP_TTL_MS: "soon" }), undefined);
  assert.equal(stageStepTtlFromEnv({}), undefined);
  assert.equal(DEFAULT_STAGE_STEP_TTL_MS, 600000);

  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  let clock = 0;
  try {
    hub = await startBridge({ port: 0, now: () => clock, stepTtlMs: 0 });
    const agent = connect(hub.url);
    const canvas = connect(hub.url);
    sockets.push(agent, canvas);
    await joinStage(canvas, "default");
    const got = waitEvent<StageStepEnvelope>(canvas, EV.STAGE_STEP_OUT);
    agent.emit(EV.STAGE_STEP_IN, { stage: "default", step: { say: "kept" }, origin: "mia" });
    await got;
    clock += 365 * 24 * 60 * 60 * 1000;
    const body = (await (await fetch(`${hub.url}/stage/default`)).json()) as StageState;
    assert.equal(body.step?.step.say, "kept");
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
  }
});

test("a loaded tour replaces the step, and is what a late canvas receives", async () => {
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  try {
    hub = await startBridge({ port: 0 });
    const canvas = connect(hub.url);
    const agent = connect(hub.url);
    sockets.push(canvas, agent);
    await joinStage(canvas, "default");
    agent.emit(EV.STAGE_STEP_IN, { stage: "default", step: { say: "one" }, origin: "a" });
    await waitEvent(canvas, EV.STAGE_STEP_OUT);
    const loaded = waitEvent<StageLoadEnvelope>(canvas, EV.STAGE_LOAD_OUT);
    agent.emit(EV.STAGE_LOAD_IN, {
      stage: "default",
      tour: { settings: { namespace: "n", name: "Walk" }, steps: [{ say: "a" }, { say: "b" }] },
      from: 1,
      origin: "a",
    });
    assert.equal((await loaded).from, 1);
    const late = connect(hub.url);
    sockets.push(late);
    const state = (await joinStage(late, "default")).state!;
    assert.equal(state.step, undefined);
    assert.equal(state.tour?.tour.settings.name, "Walk");
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
  }
});

test("a canvas's context reaches the agents on its stage and not itself; marks reach the drawing's room and the stage", async () => {
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  try {
    hub = await startBridge({ port: 0 });
    const canvas = connect(hub.url);
    const listener = connect(hub.url);
    const drawing = connect(hub.url);
    sockets.push(canvas, listener, drawing);
    await joinStage(canvas, "default");
    await joinStage(listener, "default");
    await new Promise((r) => drawing.emit(EV.JOIN, { role: "web", docId: "/tmp/stage-marks-test.smdf.json" }, r));

    let echoed = false;
    canvas.on(EV.STAGE_CONTEXT_OUT, () => (echoed = true));
    const heard = waitEvent<StageContext>(listener, EV.STAGE_CONTEXT_OUT);
    canvas.emit(EV.STAGE_CONTEXT_IN, { stage: "default", doc: "/d/w.smdf.json", kind: "machine", focus: "state:B", who: "Guillaume" });
    const ctx = await heard;
    assert.equal(ctx.focus, "state:B");
    await quiet();
    assert.equal(echoed, false);
    const kept = (await (await fetch(`${hub.url}/stage/default`)).json()) as StageState;
    assert.equal(kept.context?.who, "Guillaume");

    const inRoom = waitEvent<MarksEnvelope>(drawing, EV.MARKS_OUT);
    const onStage = waitEvent<MarksEnvelope>(listener, EV.MARKS_OUT);
    let toSelf = false;
    canvas.on(EV.MARKS_OUT, () => (toSelf = true));
    canvas.emit(EV.MARKS_IN, {
      docId: "/tmp/stage-marks-test.smdf.json",
      marks: [],
      change: { action: "add", id: "m-1" },
      stage: "default",
      origin: "web",
    });
    assert.equal((await inRoom).change?.id, "m-1");
    assert.equal((await onStage).change?.id, "m-1");
    await quiet();
    assert.equal(toSelf, false, "the writer is not told what it wrote");
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
  }
});

test("with a token, stage frames and the stage endpoint refuse a stranger", async () => {
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  try {
    hub = await startBridge({ port: 0, token: "secret" });
    const canvas = connect(hub.url, "secret");
    const stranger = connect(hub.url);
    sockets.push(canvas, stranger);
    await joinStage(canvas, "default");
    let leaked = false;
    canvas.on(EV.STAGE_STEP_OUT, () => (leaked = true));
    const refused = waitEvent<{ message: string }>(stranger, EV.ERROR);
    stranger.emit(EV.STAGE_STEP_IN, { stage: "default", step: { say: "no" }, origin: "x" });
    assert.match((await refused).message, /token/);
    await quiet();
    assert.equal(leaked, false);
    assert.equal((await fetch(`${hub.url}/stage/default`)).status, 401);
    assert.equal((await fetch(`${hub.url}/stage/default`, { headers: { authorization: "Bearer secret" } })).status, 200);
    assert.equal((await fetch(`${hub.url}/stage/a%20b`, { headers: { authorization: "Bearer secret" } })).status, 400);
    assert.equal((await fetch(`${hub.url}/health`)).status, 200);
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
  }
});
