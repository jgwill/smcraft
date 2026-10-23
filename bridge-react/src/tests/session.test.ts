/**
 * Behaviour of the framework-agnostic `createBridgeSession` against a throwaway
 * socket.io hub (no React, no DOM). The hub answers `bridge:join` via ack with a
 * minimal one-state snapshot, then pushes `def:patch` frames so we can prove:
 *
 *   1. join seeds `def` and flips status to 'connected';
 *   2. a structural `state.add` patch rebuilds `def` (applyPatchOps applied) and
 *      fires `subscribe`;
 *   3. a `runtime.enter` patch adds to `activeStates` while leaving `def`
 *      structurally unchanged (presentational op — no ghost `Foo` duplicate);
 *   4. a `runtime.exit` patch removes it from `activeStates`.
 *
 * A single sequential test keeps the seq progression (0 -> 1 -> 2 -> 3) coherent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createBridgeSession, type BridgeSession } from "../session.js";
import {
  EV,
  collectStateNames,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";

const minimalDef: StateMachineDefinition = {
  settings: { namespace: "test", asynchronous: false },
  events: [{ name: "src", events: [{ id: "go" }] }],
  state: { name: "Root" },
};

/** Resolve once `pred()` holds, watching the session's subscribe fan-out. */
function waitFor(session: BridgeSession, pred: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (pred()) {
      resolve();
      return;
    }
    const off = session.subscribe(() => {
      if (pred()) {
        off();
        resolve();
      }
    });
  });
}

test("bridge-session: join seeds def, structural patch mutates def, runtime ops track activeStates", async () => {
  // --- stand up a throwaway hub on an ephemeral port ---
  const httpServer: HttpServer = createServer();
  const io = new Server(httpServer);

  let serverSocket: import("socket.io").Socket | undefined;
  io.on("connection", (s) => {
    serverSocket = s;
    s.on(EV.JOIN, (payload: { docId: string }, ack: (r: unknown) => void) => {
      ack({
        selfId: "self-1",
        snapshot: { docId: payload.docId, def: minimalDef, seq: 0, mtime: 0 },
        presence: [],
      });
    });
  });

  httpServer.listen(0);
  await once(httpServer, "listening");
  const address = httpServer.address();
  const port =
    typeof address === "object" && address !== null ? address.port : Number(address);

  const session = createBridgeSession({
    url: `http://localhost:${port}`,
    role: "runtime",
    docId: "doc-1",
    name: "tester",
  });

  // Count subscriber fan-outs so we can prove `subscribe` fired on a patch.
  let fires = 0;
  const offCounter = session.subscribe(() => {
    fires += 1;
  });

  try {
    // 1. connect() joins; def is seeded from the ack snapshot, status connected.
    session.connect();
    await waitFor(
      session,
      () => session.getSnapshot().def !== null && session.getSnapshot().status === "connected",
    );
    assert.equal(session.getSnapshot().status, "connected");
    assert.deepEqual(session.getSnapshot().def, minimalDef);
    assert.equal(session.getSnapshot().seq, 0);

    // 2. structural def:patch{seq:1, state.add Foo} -> subscribe fires, def gains Foo.
    const firesBefore = fires;
    const gotFoo = waitFor(session, () =>
      collectStateNames(session.getSnapshot().def!.state).includes("Foo"),
    );
    serverSocket!.emit(EV.PATCH_OUT, {
      docId: "doc-1",
      seq: 1,
      ops: [{ op: "state.add", parent: "Root", state: { name: "Foo" } }],
      origin: "server",
    });
    await gotFoo;
    assert.ok(fires > firesBefore, "subscribe should fire on an incoming patch");
    assert.deepEqual(collectStateNames(session.getSnapshot().def!.state), ["Root", "Foo"]);
    assert.equal(session.getSnapshot().seq, 1);
    assert.deepEqual(session.getSnapshot().activeStates, []);

    // 3. runtime.enter Foo -> activeStates gains Foo; def is UNCHANGED (no dup Foo).
    const gotActive = waitFor(session, () =>
      session.getSnapshot().activeStates.includes("Foo"),
    );
    serverSocket!.emit(EV.PATCH_OUT, {
      docId: "doc-1",
      seq: 2,
      ops: [{ op: "runtime.enter", state: "Foo" }],
      origin: "server",
    });
    await gotActive;
    assert.deepEqual(session.getSnapshot().activeStates, ["Foo"]);
    // def still exactly one Foo — the runtime op is presentational only.
    assert.deepEqual(collectStateNames(session.getSnapshot().def!.state), ["Root", "Foo"]);

    // 4. runtime.exit Foo -> activeStates drops Foo.
    const gotInactive = waitFor(
      session,
      () => !session.getSnapshot().activeStates.includes("Foo"),
    );
    serverSocket!.emit(EV.PATCH_OUT, {
      docId: "doc-1",
      seq: 3,
      ops: [{ op: "runtime.exit", state: "Foo" }],
      origin: "server",
    });
    await gotInactive;
    assert.deepEqual(session.getSnapshot().activeStates, []);
    assert.deepEqual(collectStateNames(session.getSnapshot().def!.state), ["Root", "Foo"]);
  } finally {
    offCounter();
    session.disconnect();
    io.close();
    httpServer.close();
    await once(httpServer, "close").catch(() => {});
  }
});
