/**
 * The client's stage methods (Spec 83) against a throwaway socket.io server:
 * `joinStage` resolves with the hub's state, frames go out under their event
 * names with the client's name as origin, and relayed frames come back as
 * `stage-step` / `stage-load` / `stage-control` / `stage-context` / `marks`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { createBridgeClient } from "../client.js";
import { EV, type MarksEnvelope, type StageContext, type StageStepEnvelope } from "@miadi/stateloom-protocol";

test("bridge-client: stage join, emit and receive", async () => {
  const httpServer = createServer();
  const io = new Server(httpServer);
  const received: Record<string, unknown[]> = {};
  io.on("connection", (s) => {
    s.on(EV.STAGE_JOIN, (p: { stage: string }, ack: (r: unknown) => void) => {
      s.join(`stage:${p.stage}`);
      ack({ selfId: s.id, state: { stage: p.stage, context: { stage: p.stage, doc: "/d/x.smdf.json", at: "t" } } });
    });
    for (const ev of [EV.STAGE_STEP_IN, EV.STAGE_LOAD_IN, EV.STAGE_CONTROL_IN, EV.STAGE_CONTEXT_IN, EV.MARKS_IN]) {
      s.on(ev, (env: unknown) => (received[ev] ??= []).push(env));
    }
  });
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const client = createBridgeClient({ url, role: "agent", docId: "/d/x.smdf.json", name: "mia" });
  try {
    const joined = await client.joinStage("trading");
    assert.equal(joined.state.stage, "trading");
    assert.equal(joined.state.context?.doc, "/d/x.smdf.json");

    await client.emitStep({ stage: "trading", step: { say: "look", focus: "state:A" } });
    await client.emitControl({ stage: "trading", action: "pause" });
    client.emitContext({ stage: "trading", doc: "/d/x.smdf.json", focus: "state:A" });
    await client.emitMarks({ docId: "/d/x.smdf.json", marks: [], stage: "trading" });
    await new Promise((r) => setTimeout(r, 150));
    const step = received[EV.STAGE_STEP_IN]?.[0] as StageStepEnvelope;
    assert.equal(step.origin, "mia");
    assert.equal(step.step.focus, "state:A");
    assert.equal((received[EV.STAGE_CONTROL_IN]?.[0] as { action: string }).action, "pause");
    assert.ok((received[EV.STAGE_CONTEXT_IN]?.[0] as StageContext).at, "context is stamped");
    assert.equal((received[EV.MARKS_IN]?.[0] as MarksEnvelope).origin, "mia");

    const heard = new Promise<StageStepEnvelope>((resolve) => {
      const off = client.on("stage-step", (e) => {
        off();
        resolve(e);
      });
    });
    const marks = new Promise<MarksEnvelope>((resolve) => client.on("marks", resolve));
    io.to("stage:trading").emit(EV.STAGE_STEP_OUT, { stage: "trading", step: { say: "relayed" }, origin: "hub" });
    io.to("stage:trading").emit(EV.MARKS_OUT, { docId: "/d/x.smdf.json", marks: [], origin: "web" });
    assert.equal((await heard).step.say, "relayed");
    assert.equal((await marks).origin, "web");
  } finally {
    client.disconnect();
    await new Promise<void>((r) => io.close(() => r()));
  }
});
