/**
 * Client behaviour against a throwaway socket.io hub.
 *
 * The hub answers `bridge:join` via ack, relays server-originated `def:patch`
 * frames, and lets us push an out-of-order frame so we can prove the client's
 * sequence-gap auto-resync fires a `def:request`. One sequential test keeps the
 * lastSeq progression (3 -> 4 -> 6) coherent across assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createBridgeClient } from "../client.js";
import { EV, type StateMachineDefinition, type PatchOp } from "@smcraft/bridge-protocol";

const minimalDef: StateMachineDefinition = {
  settings: { namespace: "test", asynchronous: false },
  events: [{ name: "src", events: [{ id: "go" }] }],
  state: { name: "Root" },
};

/** Resolve on the next client `patch` event, auto-unsubscribing. */
function nextClientPatch(
  client: ReturnType<typeof createBridgeClient>,
): Promise<{ seq: number }> {
  return new Promise((resolve) => {
    const off = client.on("patch", (e) => {
      off();
      resolve(e);
    });
  });
}

test("bridge-client: join, emit, gap-resync, disconnect", async () => {
  // --- stand up a throwaway hub on an ephemeral port ---
  const httpServer: HttpServer = createServer();
  const io = new Server(httpServer);

  let serverSocket: import("socket.io").Socket | undefined;
  const gotConnection = new Promise<import("socket.io").Socket>((resolve) => {
    io.on("connection", (s) => {
      serverSocket = s;
      s.on(EV.JOIN, (payload: { docId: string }, ack: (r: unknown) => void) => {
        ack({
          selfId: "self-1",
          snapshot: { docId: payload.docId, def: minimalDef, seq: 3, mtime: 0 },
          presence: [],
        });
      });
      resolve(s);
    });
  });

  httpServer.listen(0);
  await once(httpServer, "listening");
  const address = httpServer.address();
  const port =
    typeof address === "object" && address !== null ? address.port : Number(address);

  const client = createBridgeClient({
    url: `http://localhost:${port}`,
    role: "cli",
    docId: "doc-1",
    name: "tester",
  });

  try {
    // 1. join() resolves; lastSeq seeded from snapshot.seq === 3
    const result = await client.join();
    await gotConnection;
    assert.equal(result.snapshot.seq, 3);
    assert.equal(result.selfId, "self-1");
    assert.equal(client.lastSeq, 3);
    assert.equal(client.status, "connected");

    // 2. emitPatch reaches the hub with the right event name + ops
    const ops: PatchOp[] = [
      { op: "state.add", parent: "Root", state: { name: "S1" } },
    ];
    const patchAtHub = once(serverSocket!, EV.PATCH_IN);
    client.emitPatch(ops);
    const [received] = (await patchAtHub) as [{ ops: PatchOp[]; docId: string }];
    assert.equal(received.docId, "doc-1");
    assert.deepEqual(received.ops, ops);

    // 3. incoming def:patch{seq:4} fires 'patch' and advances lastSeq to 4
    const patch4 = nextClientPatch(client);
    serverSocket!.emit(EV.PATCH_OUT, {
      docId: "doc-1",
      seq: 4,
      ops: [],
      origin: "server",
    });
    const env4 = await patch4;
    assert.equal(env4.seq, 4);
    assert.equal(client.lastSeq, 4);

    // 4. incoming def:patch{seq:6} is a gap -> client emits def:request, still forwards
    const seqBeforeGap = client.lastSeq; // 4
    const requestAtHub = once(serverSocket!, EV.REQUEST);
    const patch6 = nextClientPatch(client);
    serverSocket!.emit(EV.PATCH_OUT, {
      docId: "doc-1",
      seq: 6,
      ops: [],
      origin: "server",
    });
    const env6 = await patch6; // event still forwarded despite the gap
    assert.equal(env6.seq, 6);
    const [reqPayload] = (await requestAtHub) as [{ sinceSeq: number }];
    assert.equal(reqPayload.sinceSeq, seqBeforeGap);
    assert.equal(client.lastSeq, 6);

    // 5. disconnect() transitions status to 'disconnected'
    client.disconnect();
    assert.equal(client.status, "disconnected");
  } finally {
    client.disconnect();
    io.close();
    httpServer.close();
    await once(httpServer, "close").catch(() => {});
  }
});
