/**
 * Cold-load hydration regression (HANDOFF v2, Phase 1). A tab that joins a room
 * whose join-ack snapshot ALREADY carries a def must receive that def through
 * the same `onFull` channel as a live `def:full` broadcast — otherwise
 * callback-only consumers (SocketBridgeProvider) render an empty canvas until
 * the next remote edit.
 *
 *   1. join-ack with a def -> `onFull` fires exactly once, and it has already
 *      fired by the time the def-carrying snapshot reaches subscribers;
 *   2. join-ack with `def: null` (fresh project) -> `onFull` must NOT fire, so
 *      the consumer's `lastSentDef === null` seeding path stays intact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createBridgeSession } from "../session.js";
import {
  EV,
  type FullEnvelope,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";

const minimalDef: StateMachineDefinition = {
  settings: { namespace: "test", asynchronous: false },
  events: [{ name: "src", events: [{ id: "go" }] }],
  state: { name: "Root" },
};

interface Hub {
  httpServer: HttpServer;
  io: Server;
  port: number;
}

/** Throwaway hub whose join-ack snapshot carries `def` (possibly null). */
async function startHub(def: StateMachineDefinition | null): Promise<Hub> {
  const httpServer = createServer();
  const io = new Server(httpServer);
  io.on("connection", (s) => {
    s.on(EV.JOIN, (payload: { docId: string }, ack: (r: unknown) => void) => {
      ack({
        selfId: "self-1",
        snapshot: { docId: payload.docId, def, seq: 7, mtime: 1234 },
        presence: [],
      });
    });
  });
  httpServer.listen(0);
  await once(httpServer, "listening");
  const address = httpServer.address();
  const port =
    typeof address === "object" && address !== null ? address.port : Number(address);
  return { httpServer, io, port };
}

async function closeHub(hub: Hub): Promise<void> {
  hub.io.close();
  hub.httpServer.close();
  await once(hub.httpServer, "close").catch(() => {});
}

test("bridge-session: join-ack carrying a def fires onFull exactly once, before the def broadcast", async () => {
  const hub = await startHub(minimalDef);

  const fullCalls: FullEnvelope[] = [];
  const session = createBridgeSession({
    url: `http://localhost:${hub.port}`,
    role: "web",
    docId: "doc-hydrate",
    name: "cold-tab",
    onFull: (e) => fullCalls.push(e),
  });

  // Capture how many onFull calls had landed at the exact moment the seeded
  // def first reached subscribers — "before any broadcast" made assertable.
  let fullCallsAtDefBroadcast = -1;
  const off = session.subscribe(() => {
    if (fullCallsAtDefBroadcast === -1 && session.getSnapshot().def !== null) {
      fullCallsAtDefBroadcast = fullCalls.length;
    }
  });

  try {
    session.connect();
    await new Promise<void>((resolve) => {
      if (session.getSnapshot().def !== null) return resolve();
      const done = session.subscribe(() => {
        if (session.getSnapshot().def !== null) {
          done();
          resolve();
        }
      });
    });
    // Let any trailing microtasks/frames settle so a double-fire would show.
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(fullCalls.length, 1, "onFull must fire exactly once on a def-carrying join");
    assert.equal(
      fullCallsAtDefBroadcast,
      1,
      "onFull must have fired before the seeded def was broadcast to subscribers",
    );
    const e = fullCalls[0]!;
    assert.equal(e.docId, "doc-hydrate");
    assert.deepEqual(e.def, minimalDef);
    assert.equal(e.seq, 7);
    assert.equal(e.mtime, 1234);
  } finally {
    off();
    session.disconnect();
    await closeHub(hub);
  }
});

test("bridge-session: join-ack with def:null (fresh project) does NOT fire onFull", async () => {
  const hub = await startHub(null);

  const fullCalls: FullEnvelope[] = [];
  const session = createBridgeSession({
    url: `http://localhost:${hub.port}`,
    role: "web",
    docId: "doc-fresh",
    name: "cold-tab",
    onFull: (e) => fullCalls.push(e),
  });

  try {
    session.connect();
    await new Promise<void>((resolve) => {
      if (session.getSnapshot().status === "connected") return resolve();
      const done = session.subscribe(() => {
        if (session.getSnapshot().status === "connected") {
          done();
          resolve();
        }
      });
    });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(fullCalls.length, 0, "a null-def join must not fire onFull");
    assert.equal(session.getSnapshot().def, null);
  } finally {
    session.disconnect();
    await closeHub(hub);
  }
});
