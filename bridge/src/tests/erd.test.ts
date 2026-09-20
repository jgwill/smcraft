/**
 * An ERD room (Spec 80). The hub keys rooms by document path and never
 * validates what a room holds, so a `.erdf.json` rides the same hub — but it
 * has no PatchOp vocabulary, so every change must arrive whole:
 *
 *   1. a join seeds the room from the bare ERDF on disk;
 *   2. a peer's whole-document push reaches the other peer;
 *   3. an external edit of the file is broadcast as `def:full`, never as a patch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  EV,
  addEntity,
  emptyErd,
  isErdDefinition,
  type EntityRelationshipDefinition,
} from "@miadi/stateloom-protocol";
import { startBridge, type BridgeHandle } from "../index.js";

function waitEvent<T = unknown>(sock: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handler = (arg: unknown): void => {
      clearTimeout(timer);
      resolve(arg as T);
    };
    const timer = setTimeout(() => {
      sock.off(event, handler);
      reject(new Error(`timeout (${ms}ms) waiting for "${event}"`));
    }, ms);
    sock.once(event, handler);
  });
}

const connect = (url: string): ClientSocket =>
  ioClient(url, { transports: ["websocket"], reconnection: false, forceNew: true });

const joinRoom = (sock: ClientSocket, role: string, docId: string): Promise<{ snapshot: { def: unknown } }> =>
  new Promise((resolve) => sock.emit(EV.JOIN, { role, name: role, docId }, resolve));

test("an ERD document rides the hub whole", async () => {
  const docPath = pathJoin(tmpdir(), `stateloom-erd-${process.pid}-${Date.now()}.erdf.json`);
  const onDisk = addEntity(emptyErd("demo", "Library"), { name: "Member" });
  writeFileSync(docPath, JSON.stringify(onDisk, null, 2), "utf8");

  const handle: BridgeHandle = await startBridge({ port: 0, host: "127.0.0.1", file: docPath });
  const agent = connect(handle.url);
  const web = connect(handle.url);
  try {
    await Promise.all([waitEvent(agent, "connect"), waitEvent(web, "connect")]);

    const ack = await joinRoom(agent, "agent", docPath);
    assert.ok(isErdDefinition(ack.snapshot.def), "the room was seeded from the bare ERDF on disk");
    assert.deepEqual(ack.snapshot.def, onDisk);
    await joinRoom(web, "web", docPath);

    const pushed = addEntity(onDisk, { name: "Loan" });
    const webSees = waitEvent<{ def: EntityRelationshipDefinition; seq: number }>(web, EV.FULL_OUT);
    agent.emit(EV.FULL_IN, { docId: docPath, def: pushed });
    const full = await webSees;
    assert.deepEqual(full.def.entities.map((e) => e.name), ["Member", "Loan"]);
    assert.equal(full.seq, 1);

    const edited = addEntity(pushed, { name: "Book" });
    let sawPatch = false;
    web.on(EV.PATCH_OUT, () => (sawPatch = true));
    const webSeesFile = waitEvent<{ def: EntityRelationshipDefinition; origin: string }>(web, EV.FULL_OUT);
    writeFileSync(docPath, JSON.stringify(edited, null, 2), "utf8");
    const fromFile = await webSeesFile;
    assert.equal(fromFile.origin, "file");
    assert.deepEqual(fromFile.def.entities.map((e) => e.name), ["Member", "Loan", "Book"]);
    assert.equal(sawPatch, false, "an ERD never travels as a patch");
  } finally {
    agent.close();
    web.close();
    await handle.close();
    rmSync(docPath, { force: true });
  }
});
