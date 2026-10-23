/**
 * A view (Spec 82): an agent asks the canvases open on a system to show a
 * member and focus an element. The hub relays it to the system's room — the
 * sender need not have joined it — and keeps nothing: a room's document and
 * sequence are untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { EV, emptySystem, type ViewEnvelope } from "@miadi/stateloom-protocol";
import { startBridge, type BridgeHandle } from "../index.js";

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

const joined = (sock: ClientSocket, docId: string) =>
  new Promise<{ snapshot: { seq: number } }>((resolve) => sock.emit(EV.JOIN, { role: "web", docId }, resolve));

test("a view reaches the system's room from a socket that never joined it, and changes nothing", async () => {
  const system = pathJoin(tmpdir(), `view-${process.pid}.sysdf.json`);
  const member = pathJoin(tmpdir(), `view-${process.pid}.smdf.json`);
  writeFileSync(system, JSON.stringify(emptySystem("demo", "S")));
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  try {
    hub = await startBridge({ port: 0, docId: member });
    const canvas = connect(hub.url);
    const agent = connect(hub.url);
    const bystander = connect(hub.url);
    sockets.push(canvas, agent, bystander);
    const before = await joined(canvas, system);
    await joined(bystander, member);

    let strayView = false;
    bystander.on(EV.VIEW_OUT, () => (strayView = true));
    const got = waitEvent<ViewEnvelope>(canvas, EV.VIEW_OUT);
    agent.emit(EV.VIEW_IN, { docId: system, member: "a.erdf.json", focus: "entity:Order", origin: "agent", note: "the order" });
    const view = await got;
    assert.equal(view.docId, system);
    assert.equal(view.member, "a.erdf.json");
    assert.equal(view.focus, "entity:Order");
    assert.equal(view.origin, "agent");
    assert.equal(view.note, "the order");

    await new Promise((r) => setTimeout(r, 150));
    assert.equal(strayView, false, "a member's room does not hear the system's view");
    const again = connect(hub.url);
    sockets.push(again);
    const after = await joined(again, system);
    assert.equal(after.snapshot.seq, before.snapshot.seq, "no document change");
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
    rmSync(system, { force: true });
  }
});

test("with a token, a view without it is refused", async () => {
  const system = pathJoin(tmpdir(), `view-token-${process.pid}.sysdf.json`);
  writeFileSync(system, JSON.stringify(emptySystem("demo", "S")));
  let hub: BridgeHandle | undefined;
  const sockets: ClientSocket[] = [];
  try {
    hub = await startBridge({ port: 0, docId: system, token: "secret" });
    const canvas = connect(hub.url, "secret");
    const stranger = connect(hub.url);
    sockets.push(canvas, stranger);
    await joined(canvas, system);
    let heard = false;
    canvas.on(EV.VIEW_OUT, () => (heard = true));
    const refused = waitEvent<{ message: string }>(stranger, EV.ERROR);
    stranger.emit(EV.VIEW_IN, { docId: system, member: "x.smdf.json", origin: "stranger" });
    assert.match((await refused).message, /auth token/);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(heard, false);
  } finally {
    for (const s of sockets) s.disconnect();
    await hub?.close();
    rmSync(system, { force: true });
  }
});
