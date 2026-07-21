/**
 * Integration tests for the @smcraft/bridge socket.io hub.
 *
 * Boots the hub on an ephemeral port over a temp docId file, connects two
 * socket.io-client peers, and asserts: presence lifecycle, granular def:patch
 * propagation + seq + ack, external-file-edit diff broadcast, and self-write
 * echo dedup (no double broadcast).
 *
 * Determinism: no sleeps for "event happened" — we await the specific event
 * (with a timeout guard). The one unavoidable wait is the "assert NOTHING is
 * broadcast" dedup check, which uses a fixed window.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  EV,
  applyPatchOps,
  type StateMachineDefinition,
  type PatchOp,
} from "@smcraft/bridge-protocol";
import { startBridge, type BridgeHandle } from "../index.js";

/** Resolve the next occurrence of `event`, rejecting after `ms` to avoid hangs. */
function waitEvent<T = unknown>(sock: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handler = (...args: unknown[]): void => {
      clearTimeout(timer);
      resolve((args.length > 1 ? args : args[0]) as T);
    };
    const timer = setTimeout(() => {
      sock.off(event, handler);
      reject(new Error(`timeout (${ms}ms) waiting for "${event}"`));
    }, ms);
    sock.once(event, handler);
  });
}

/** Emit bridge:join and resolve with the hub's ack payload. */
function join(
  sock: ClientSocket,
  payload: { role: string; name?: string; docId: string },
): Promise<{ selfId: string; snapshot: { docId: string; def: unknown; seq: number; mtime: number }; presence: Array<{ clientId: string; role: string }> }> {
  return new Promise((resolve) => sock.emit(EV.JOIN, payload, resolve));
}

function connect(url: string): ClientSocket {
  return ioClient(url, { transports: ["websocket"], reconnection: false, forceNew: true });
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const opsAdd = (name: string): PatchOp[] => [
  { op: "state.add", parent: null, state: { name } },
];

test("smcraft bridge hub — presence, granular patch, external diff, dedup", async (t) => {
  const docPath = pathJoin(tmpdir(), `smcraft-bridge-${process.pid}-${Date.now()}.smdf.json`);

  const initialDef: StateMachineDefinition = {
    settings: { namespace: "demo", asynchronous: false },
    events: [],
    state: { name: "Root", states: [] },
  };
  writeFileSync(docPath, JSON.stringify({ stateMachine: initialDef }, null, 2), "utf8");

  const handle: BridgeHandle = await startBridge({ port: 0, host: "127.0.0.1", file: docPath });

  let clientA: ClientSocket | null = null;
  let clientB: ClientSocket | null = null;

  try {
    clientA = connect(handle.url);
    clientB = connect(handle.url);
    await waitEvent(clientA, "connect");
    await waitEvent(clientB, "connect");

    // Track the definition the hub is expected to hold, in lockstep.
    let currentDef = initialDef;

    // --- 1. presence: A (cli) and B (web) see each other ---------------------
    const ackA = await join(clientA, { role: "cli", name: "A", docId: docPath });
    assert.equal(typeof ackA.selfId, "string");
    assert.equal(typeof ackA.snapshot.docId, "string");
    assert.ok(ackA.snapshot.docId.endsWith(".smdf.json"), "snapshot carries the normalized docId");
    assert.equal(ackA.snapshot.seq, 0);

    // A must learn about B's arrival via presence:join.
    const aSeesB = waitEvent<{ clientId: string; role: string }>(clientA, EV.PRESENCE_JOIN);
    const ackB = await join(clientB, { role: "web", name: "B", docId: docPath });

    // B learns A via its own join ack's presence list (both peers present).
    const rolesInAckB = ackB.presence.map((p) => p.role).sort();
    assert.deepEqual(rolesInAckB, ["cli", "web"], "B's ack presence lists both peers");
    assert.ok(ackB.presence.some((p) => p.clientId === ackA.selfId), "B sees A");

    const bJoin = await aSeesB;
    assert.equal(bJoin.clientId, ackB.selfId, "A received B's presence:join");
    assert.equal(bJoin.role, "web");

    await t.test("presence: both peers observe each other", () => {
      assert.ok(true);
    });

    // --- 2. def:patch propagates with seq===1 + identical ops; origin acked --
    await t.test("def:patch propagates with seq and ack", async () => {
      const ops = opsAdd("Alpha");
      const bPatch = waitEvent<{ docId: string; seq: number; ops: PatchOp[]; origin: string }>(clientB!, EV.PATCH_OUT);
      const aAck = waitEvent<{ docId: string; baseSeq?: number; seq: number }>(clientA!, EV.ACK);
      // Synthetic mtime that cannot collide with a real fs mtime → clean apply.
      clientA!.emit(EV.PATCH_IN, { docId: docPath, ops, origin: ackA.selfId, baseSeq: 0, mtime: 1 });

      const patch = await bPatch;
      assert.equal(patch.seq, 1, "hub assigned seq 1");
      assert.deepEqual(patch.ops, ops, "B received identical ops");

      const ack = await aAck;
      assert.equal(ack.seq, 1, "origin acked with assigned seq");

      currentDef = applyPatchOps(currentDef, ops);
    });

    // --- 3. external file edit → hub-diffed def:patch (origin 'file') ---------
    await t.test("external file edit becomes a hub-diffed broadcast", async () => {
      const externalDef = applyPatchOps(currentDef, opsAdd("Beta"));
      const bEvent = waitEvent<{ seq: number; ops?: PatchOp[]; def?: unknown; origin: string }>(clientB!, EV.PATCH_OUT);
      // Raw external write (new mtime, new content — not in the hub's dedup ring).
      writeFileSync(docPath, JSON.stringify({ stateMachine: externalDef }, null, 2), "utf8");

      const evt = await bEvent;
      assert.equal(evt.origin, "file", "broadcast attributed to the file watcher");
      assert.equal(evt.seq, 2, "hub advanced seq to 2");
      assert.ok(Array.isArray(evt.ops) && evt.ops.length > 0, "granular ops emitted");

      currentDef = externalDef;
    });

    // --- 4. self-write echo dedup: identical content the hub already holds ----
    await t.test("identical re-write is deduped (no rebroadcast)", async () => {
      let broadcastSeen = false;
      const markP = (): void => { broadcastSeen = true; };
      const markF = (): void => { broadcastSeen = true; };
      clientB!.on(EV.PATCH_OUT, markP);
      clientB!.on(EV.FULL_OUT, markF);

      // Byte-identical content → same hashDef → hits the ring's hash dedup.
      writeFileSync(docPath, JSON.stringify({ stateMachine: currentDef }, null, 2), "utf8");
      await delay(700);

      clientB!.off(EV.PATCH_OUT, markP);
      clientB!.off(EV.FULL_OUT, markF);
      assert.equal(broadcastSeen, false, "no def:* broadcast for a self-write echo");
    });
  } finally {
    clientA?.disconnect();
    clientB?.disconnect();
    await handle.close();
  }
});

test("smcraft bridge hub — no base def: errors the sender, never broadcasts null", async () => {
  // File intentionally does NOT exist → the room seeds with def === null.
  const docPath = pathJoin(tmpdir(), `smcraft-bridge-nb-${process.pid}-${Date.now()}.smdf.json`);
  const handle: BridgeHandle = await startBridge({ port: 0, host: "127.0.0.1", file: docPath });
  let a: ClientSocket | null = null;
  let b: ClientSocket | null = null;
  try {
    a = connect(handle.url);
    b = connect(handle.url);
    await waitEvent(a, "connect");
    await waitEvent(b, "connect");
    const ackA = await join(a, { role: "cli", name: "A", docId: docPath });
    await join(b, { role: "web", name: "B", docId: docPath });
    assert.equal(ackA.snapshot.def, null, "no base def on a fresh, file-less project");

    // A patch with no base and no file on disk: the sender must be told, and the
    // room must NOT receive a def:full carrying a null def.
    let bGotBroadcast = false;
    const markP = (): void => { bGotBroadcast = true; };
    const markF = (): void => { bGotBroadcast = true; };
    b!.on(EV.PATCH_OUT, markP);
    b!.on(EV.FULL_OUT, markF);

    const aErr = waitEvent(a, EV.ERROR);
    a!.emit(EV.PATCH_IN, { docId: docPath, ops: opsAdd("Ghost"), origin: ackA.selfId, mtime: 1 });
    await aErr; // sender is told there is no base to patch
    await delay(300);

    b!.off(EV.PATCH_OUT, markP);
    b!.off(EV.FULL_OUT, markF);
    assert.equal(bGotBroadcast, false, "hub never broadcasts a null def to the room");
  } finally {
    a?.disconnect();
    b?.disconnect();
    await handle.close();
  }
});
