/**
 * The whole loop against a real hub (Spec 82): an agent adds a message with a
 * new event and a new state, check_system names it (L005), reconcile_scenario
 * apply:true writes the machine and a canvas joined to the machine's room
 * receives the `def:patch`, and `show` reaches a canvas joined to the system's
 * room. The hub is this repo's own (`bridge/dist`), started on a free port.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBridgeClient, type BridgeClient } from "@miadi/stateloom-client";
import type { PatchEnvelope, StateMachineDefinition, ViewEnvelope } from "@miadi/stateloom-protocol";
import { liveBridge } from "../live.js";
import { MACHINE, NEW_MESSAGE, SEQUENCE, SYSTEM, sysRig } from "./systemRig.js";

interface Hub {
  url: string;
  close(): Promise<void>;
}

async function startHub(docId: string, token?: string): Promise<Hub | null> {
  const where = new URL("../../../bridge/dist/index.js", import.meta.url).href;
  try {
    const { startBridge } = (await import(where)) as {
      startBridge(o: { port: number; docId: string; token?: string }): Promise<Hub>;
    };
    return await startBridge({ port: 0, docId, token });
  } catch {
    return null;
  }
}

function waitFor<T>(client: BridgeClient, event: "patch" | "view", ms = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} in ${ms} ms`)), ms);
    const off = client.on(event as "patch", (e: unknown) => {
      clearTimeout(timer);
      off();
      resolve(e as T);
    });
  });
}

const canvas = (url: string, docId: string): BridgeClient =>
  createBridgeClient({ url, role: "web", docId, name: "canvas" });

const countFulfilled = (def: StateMachineDefinition): number => {
  let n = 0;
  const walk = (s: StateMachineDefinition["state"]): void => {
    n += (s.transitions ?? []).filter((t) => t.event === "CountFulfilled").length;
    (s.states ?? []).forEach(walk);
  };
  walk(def.state);
  return n;
};

test("live loop: add_message → check_system L005 → reconcile apply patches the machine's room → show reaches the system's room", async (t) => {
  const probe = await sysRig();
  const hub = await startHub(join(probe.dir, SYSTEM));
  await probe.close();
  if (!hub) {
    t.skip("bridge/dist is not built");
    return;
  }
  const clients: BridgeClient[] = [];
  const r = await sysRig({ live: liveBridge({ url: hub.url, name: "loom-agent", timeoutMs: 3000 }) });
  try {
    const machinePath = join(r.dir, MACHINE);
    const systemPath = join(r.dir, SYSTEM);
    const onMachine = canvas(hub.url, machinePath);
    const onSystem = canvas(hub.url, systemPath);
    clients.push(onMachine, onSystem);
    await onMachine.join();
    await onSystem.join();

    const added = await r.call("add_message", NEW_MESSAGE);
    assert.equal(added.isError, false, added.text);

    const checked = await r.call("check_system");
    assert.match(checked.text, /L005 ×1\n    wave_count_to_entry\.sqdf\.json: Message 14 fires "CountFulfilled"/);

    const patches: PatchEnvelope[] = [];
    onMachine.on("patch", (e) => void patches.push(e));
    const patched = waitFor<PatchEnvelope>(onMachine, "patch");
    const applied = await r.call("reconcile_scenario", { apply: true });
    assert.equal(applied.isError, false, applied.text);
    const envelope = await patched;
    assert.match(JSON.stringify(envelope.ops), /CountFulfilled/, "the canvas on the machine hears the change");

    const onDisk = JSON.parse(readFileSync(machinePath, "utf8"));
    assert.equal(countFulfilled(onDisk.stateMachine ?? onDisk), 1, "the file holds the new transition once");
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(patches.length, 1, "one patch: the hub's file-watch echo is deduplicated");
    const late = canvas(hub.url, machinePath);
    clients.push(late);
    const snapshot = await late.join();
    assert.equal(countFulfilled(snapshot.snapshot.def), 1, "the room's copy holds it once too");

    const viewed = waitFor<ViewEnvelope>(onSystem, "view");
    const shown = await r.call("show", { member: MACHINE, focus: "state:Fulfilled", note: "the scenario added this" });
    assert.equal(shown.isError, false, shown.text);
    const view = await viewed;
    assert.equal(view.docId, systemPath);
    assert.equal(view.member, MACHINE);
    assert.equal(view.focus, "state:Fulfilled");
    assert.equal(view.origin, "loom-agent");
    assert.equal(view.note, "the scenario added this");

    process.stdout.write(
      `# live-loop evidence\n# add_message: ${added.text.replace(/\n/g, " | ")}\n` +
        `# reconcile apply: ${applied.text.replace(/\n/g, " | ")}\n` +
        `# canvas on machine got def:patch origin=${envelope.origin} seq=${envelope.seq} ops=${envelope.ops.map((o) => o.op).join(",")}\n` +
        `# canvas on system got view:show member=${view.member} focus=${view.focus}\n`,
    );
  } finally {
    for (const c of clients) c.disconnect();
    await r.close();
    await hub.close();
  }
});

test("an unreachable hub: reconcile apply still writes the machine and says it is not live", async () => {
  const r = await sysRig({ live: liveBridge({ url: "http://127.0.0.1:1", timeoutMs: 1500 }) });
  try {
    r.setActive(SEQUENCE);
    await r.call("add_message", NEW_MESSAGE);
    const applied = await r.call("reconcile_scenario", { apply: true });
    assert.equal(applied.isError, false, applied.text);
    assert.match(applied.text, /wrote 3 op\(s\) — not live: .*; the file stands/);
    const onDisk = JSON.parse(readFileSync(join(r.dir, MACHINE), "utf8"));
    assert.equal(countFulfilled(onDisk.stateMachine ?? onDisk), 1);
    const shown = await r.call("show", { member: MACHINE });
    assert.equal(shown.isError, true);
    assert.match(shown.text, /Could not ask the canvases/);
  } finally {
    await r.close();
  }
});

test("R14: a hub that refuses the token is reported as refused — for a view, a document and a patch — not as delivered", async (t) => {
  const probe = await sysRig();
  const hub = await startHub(join(probe.dir, SYSTEM), "right");
  if (!hub) {
    await probe.close();
    t.skip("bridge/dist is not built");
    return;
  }
  try {
    const wrong = liveBridge({ url: hub.url, token: "wrong", timeoutMs: 2000 });
    const started = Date.now();
    const view = await wrong.view({ docId: join(probe.dir, SYSTEM), focus: "entity:WaveCount" });
    assert.deepEqual(view, { ok: false, text: "the hub refused the view: bridge: invalid or missing auth token" });
    const full = await wrong.full(join(probe.dir, SYSTEM), { settings: { namespace: "t", name: "S" }, members: [] }, Date.now());
    assert.equal(full.ok, false);
    assert.match(full.text, /^not live: the hub refused the document: bridge: invalid or missing auth token; the file stands$/);
    const patch = await wrong.patch(join(probe.dir, MACHINE), [], {}, Date.now());
    assert.match(patch.text, /the hub refused the patch: bridge: invalid or missing auth token/);
    assert.ok(Date.now() - started < 2000, "a refusal is reported when it arrives, not after a timeout");

    const right = liveBridge({ url: hub.url, token: "right", timeoutMs: 2000 });
    assert.deepEqual(await right.view({ docId: join(probe.dir, SYSTEM) }), { ok: true, text: "view sent to the hub" });
  } finally {
    await probe.close();
    await hub.close();
  }
});
