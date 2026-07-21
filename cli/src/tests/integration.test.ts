/**
 * End-to-end: durable-first mutate + live emit against a real bridge hub.
 *
 * Boots the hub over a temp docId, subscribes a `web` watcher client, then runs
 * the `addState` command function pointed at the same doc + bridge. Asserts:
 *   (a) the temp file on disk now contains the new state (persist is truth), and
 *   (b) the watcher received a `def:patch` whose ops include a `state.add` for it.
 *
 * Determinism: no `Math.random`, no argless `new Date()` — a `Date.now()`-salted
 * temp path only. Events are awaited (with a timeout guard); the hub + all
 * clients are closed in `finally` so the process exits cleanly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, type BridgeHandle } from "@smcraft/bridge";
import { createBridgeClient } from "@smcraft/bridge-client";
import type { StateMachineDefinition, PatchEnvelope } from "@smcraft/bridge-protocol";
import { addState } from "../commands/mutations.js";
import { readDef } from "../docio.js";

/** Reject a pending promise after `ms` so a missed event fails loudly. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout (${ms}ms) waiting for ${label}`)), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

test("addState persists to disk and the bridge broadcasts a state.add patch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smcx-"));
  const doc = join(dir, `machine-${process.pid}-${Date.now()}.smdf.json`);

  const initial: StateMachineDefinition = {
    settings: { namespace: "demo", name: "m", asynchronous: false },
    events: [{ name: "Internal", events: [] }],
    state: { name: "Root", states: [] },
  };
  writeFileSync(doc, JSON.stringify({ stateMachine: initial }, null, 2), "utf8");

  const handle: BridgeHandle = await startBridge({ port: 0, host: "127.0.0.1", file: doc });

  const watcher = createBridgeClient({ url: handle.url, role: "web", docId: doc });

  // Resolve on the first patch whose ops add a state named "Foo".
  let resolveFoo!: (env: PatchEnvelope) => void;
  const sawFooPatch = new Promise<PatchEnvelope>((res) => {
    resolveFoo = res;
  });
  watcher.on("patch", (env) => {
    const hasFoo = (env.ops ?? []).some(
      (o) => o.op === "state.add" && o.state.name === "Foo",
    );
    if (hasFoo) resolveFoo(env);
  });

  try {
    await watcher.join();

    await addState("Foo", {}, { doc, bridgeUrl: handle.url });

    // (a) persistence is the source of truth
    const onDisk = readDef(doc);
    const names = (onDisk?.state.states ?? []).map((s) => s.name);
    assert.ok(names.includes("Foo"), `disk should contain "Foo"; got ${JSON.stringify(names)}`);

    // (b) a live def:patch carrying the state.add reached the watcher
    const env = await withTimeout(sawFooPatch, 3000, "def:patch with state.add Foo");
    const addFoo = (env.ops ?? []).some((o) => o.op === "state.add" && o.state.name === "Foo");
    assert.ok(addFoo, "watcher patch ops include a state.add for Foo");
  } finally {
    watcher.disconnect();
    await handle.close();
  }
});
