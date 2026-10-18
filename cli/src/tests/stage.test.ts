/**
 * `smcx marks` and `smcx stage` (Spec 83) against a real hub: a system's
 * members are the scope, `marks await` exits 0 with the person's next mark and
 * 4 on timeout, `marks reply` answers as the agent and tells the hub, and
 * `stage show` reaches a canvas on the stage.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, type BridgeHandle } from "@miadi/stateloom";
import { createBridgeClient } from "@miadi/stateloom-client";
import { addMark, type MarksEnvelope, type MarksFile, type StageStepEnvelope } from "@miadi/stateloom-protocol";
import { marksAwait, marksReply, scopeOf, stageShow } from "../commands/stage.js";

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => {
    lines.push(String(s));
    return true;
  }) as typeof process.stdout.write;
  return { lines, restore: () => void (process.stdout.write = write) };
}

test("smcx marks and stage: scope, await, reply, show", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smcx-stage-"));
  const sys = join(dir, "s.sysdf.json");
  const machine = join(dir, "m.smdf.json");
  writeFileSync(sys, JSON.stringify({ settings: { namespace: "n", name: "S" }, members: [{ path: "m.smdf.json" }, { path: "e.erdf.json" }] }));
  writeFileSync(machine, JSON.stringify({ settings: { namespace: "n" }, events: [], state: { name: "Root", states: [{ name: "A" }] } }));
  assert.deepEqual(scopeOf(sys), [machine, join(dir, "e.erdf.json")]);
  assert.deepEqual(scopeOf(machine), [machine]);

  let hub: BridgeHandle | undefined;
  const canvas = { client: null as ReturnType<typeof createBridgeClient> | null };
  try {
    hub = await startBridge({ port: 0, docId: machine });
    canvas.client = createBridgeClient({ url: hub.url, role: "web", docId: machine, name: "canvas" });
    await canvas.client.joinStage("default");
    const ctx = { doc: sys, bridgeUrl: hub.url, name: "Mia" };

    // A person marks while the agent waits.
    const sidecar = machine.replace(/\.json$/, ".marks.json");
    setTimeout(() => {
      const file = addMark({ doc: "m.smdf.json", marks: [] }, { elements: ["state:A"], text: "why A?", author: { id: "g", name: "Guillaume", role: "person" } }, "t", "m-1");
      writeFileSync(sidecar, JSON.stringify(file));
    }, 300);
    const cap = capture();
    let code: number;
    try {
      code = await marksAwait(ctx, { timeout: 10, interval: 100 });
    } finally {
      cap.restore();
    }
    assert.equal(code, 0);
    const wake = cap.lines.join("");
    assert.match(wake, /^NEW MARK FROM GUILLAUME · m\.smdf\.json/);
    assert.match(wake, /marks reply m-1 "<what you say>"/);

    const heard = new Promise<MarksEnvelope>((resolve) => canvas.client!.on("marks", resolve));
    const cap2 = capture();
    try {
      await marksReply(ctx, "m-1", "because the count starts there", {});
    } finally {
      cap2.restore();
    }
    const stored = JSON.parse(readFileSync(sidecar, "utf8")) as MarksFile;
    assert.equal(stored.marks[0].status, "answered");
    assert.equal(stored.marks[0].replies?.[0].author.name, "Mia");
    assert.equal((await heard).change?.id, "m-1", "the stage hears the reply");

    const cap3 = capture();
    let timedOut: number;
    try {
      timedOut = await marksAwait(ctx, { timeout: 1, interval: 100 });
    } finally {
      cap3.restore();
    }
    assert.equal(timedOut, 4, "an answered mark is not news; the wait times out");

    const step = new Promise<StageStepEnvelope>((resolve) => canvas.client!.on("stage-step", resolve));
    const cap4 = capture();
    try {
      await stageShow(ctx, { say: "this state", spotlight: "state:A", drawing: machine });
    } finally {
      cap4.restore();
    }
    const got = await step;
    assert.deepEqual(got.step.spotlight, ["state:A"]);
    assert.equal(got.step.system, sys, "a member shown from its system keeps the strip");
  } finally {
    canvas.client?.disconnect();
    await hub?.close();
  }
});
