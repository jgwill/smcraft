/**
 * The sequence tools (Spec 81), driven the way an agent drives them: a real
 * McpServer, a real Client, an in-memory transport, and a temp directory. The
 * host is a stand-in for server.ts's state. People count from 1 here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SequenceDefinition } from "@miadi/stateloom-protocol";
import {
  registerSequenceTools,
  sequenceGetNotes,
  sequenceLoadDefinition,
  sequenceRender,
  sequenceSetNotes,
  type SequenceHost,
} from "../sequence.js";

interface Rig {
  dir: string;
  host: SequenceHost;
  emitted: SequenceDefinition[];
  afterEdits: string[];
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  read(): SequenceDefinition;
  close(): Promise<void>;
}

async function rig(): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), "loom-seq-"));
  let active = join(dir, "machine.smdf.json");
  const emitted: SequenceDefinition[] = [];
  const afterEdits: string[] = [];
  const host: SequenceHost = {
    projectFile: () => active,
    switchTo: (p) => {
      active = p;
      return undefined;
    },
    emitFull: (def) => void emitted.push(def),
    outsideRoot: () => undefined,
    afterEdit: async (p) => {
      afterEdits.push(p);
      return "reconcile: stand-in line";
    },
  };
  const server = new McpServer({ name: "seq-test", version: "0.0.0" });
  registerSequenceTools(server, host);
  const client = new Client({ name: "seq-test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    dir,
    host,
    emitted,
    afterEdits,
    call: async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const content = r.content as { type: string; text?: string }[];
      return { text: content.map((c) => c.text ?? "").join("\n"), isError: r.isError === true };
    },
    read: () => JSON.parse(readFileSync(active, "utf8")),
    close: async () => {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("an agent tells a scenario from nothing; every edit reaches disk, the bridge, and the reconcile hook", async () => {
  const r = await rig();
  try {
    const created = await r.call("create_sequence", { namespace: "demo", name: "Checkout", description: "a buyer pays" });
    assert.equal(created.isError, false, created.text);
    assert.equal(r.host.projectFile(), join(r.dir, "Checkout.sqdf.json"));

    for (const [name, extra] of [
      ["Buyer", { actor: "Buyer" }],
      ["Shop", { service: "shop-api" }],
      ["Order", { object: "order", holds: ["Order"] }],
    ] as const) {
      const p = await r.call("add_participant", { name, ...extra });
      assert.equal(p.isError, false, p.text);
    }
    const first = await r.call("add_message", { from: "Buyer", to: "Shop", label: "places an order", event: "Place", carries: "Order" });
    assert.match(first.text, /^Added message 1: Buyer → Shop: places an order \(fires Place, carries Order\)\./);
    assert.match(first.text, /reconcile: stand-in line/, "the reconcile hook's line is appended");
    await r.call("add_message", { from: "Shop", to: "Order", label: "pays", event: "Pay", state: "Paid" });
    const inserted = await r.call("add_message", { from: "Shop", to: "Buyer", label: "confirms", reply: true, at: 2 });
    assert.match(inserted.text, /^Added message 2: Shop → Buyer: confirms \(reply\)/);

    const def = r.read();
    assert.deepEqual(def.messages.map((m) => m.label), ["places an order", "confirms", "pays"]);
    assert.equal(def.messages[2].state, "Paid");
    assert.deepEqual(def.participants[2], { name: "Order", object: "order", holds: ["Order"] });
    assert.equal(r.emitted.length, 7, "create + 3 participants + 3 messages each mirrored whole");
    assert.equal(r.afterEdits.length, 6, "every scenario edit, not the create, asks the system to reconcile");

    const valid = await r.call("validate_sequence");
    assert.equal(valid.isError, false, valid.text);
    assert.match(valid.text, /Sequence 'Checkout' is valid/);
  } finally {
    await r.close();
  }
});

test("messages are addressed from 1 and fragments by number; update, move and remove do as named", async () => {
  const r = await rig();
  try {
    await r.call("create_sequence", { namespace: "demo", name: "Flow" });
    await r.call("add_participant", { name: "A" });
    await r.call("add_participant", { name: "B" });
    for (const label of ["one", "two", "three"]) await r.call("add_message", { from: "A", to: "B", label });

    const frag = await r.call("add_fragment", {
      kind: "alt",
      label: "B is busy",
      after: 2,
      messages: [{ from: "B", to: "A", label: "later", optional: false }],
    });
    assert.match(frag.text, /Added fragment 1: alt after message 2 — B is busy \(1 message\(s\)\)/);
    assert.equal("optional" in r.read().fragments![0].messages[0], false, "optional:false writes no key");
    const fm = await r.call("add_fragment_message", { fragment: 1, from: "A", to: "B", label: "retry", event: "Retry" });
    assert.match(fm.text, /Added message f1\.2: A → B: retry \(fires Retry\)/);

    const upd = await r.call("update_message", { ref: "f1.2", state: "Retrying", optional: true });
    assert.match(upd.text, /Updated message f1\.2: A → B: retry \(fires Retry, then Retrying, optional\)/);
    const cleared = await r.call("update_message", { ref: "f1.2", optional: false, state: "" });
    assert.equal(cleared.isError, false, cleared.text);
    assert.deepEqual(r.read().fragments![0].messages[1], { from: "A", to: "B", label: "retry", event: "Retry" });

    const moved = await r.call("move_message", { ref: "3", to: 1 });
    assert.match(moved.text, /Moved message 3 to 1: A → B: three/);
    assert.deepEqual(r.read().messages.map((m) => m.label), ["three", "one", "two"]);
    assert.equal(r.read().fragments![0].after, 3, "the fragment still branches after 'two'");

    const nope = await r.call("update_message", { ref: "9", label: "x" });
    assert.equal(nope.isError, true);
    assert.match(nope.text, /Message '9' not found\. A main message is its number \(1 to 3\)/);
    const inner = await r.call("move_message", { ref: "f1.1", to: 1 });
    assert.equal(inner.isError, true);
    assert.match(inner.text, /Only main messages move/);

    const rm = await r.call("remove_message", { ref: "1" });
    assert.match(rm.text, /Removed message 1: A → B: three/);
    const rf = await r.call("remove_fragment", { fragment: 1 });
    assert.equal(rf.isError, false, rf.text);
    assert.equal(r.read().fragments, undefined);

    const gone = await r.call("remove_participant", { name: "B" });
    assert.match(gone.text, /Removed participant 'B' and 2 message\(s\) of theirs/);
  } finally {
    await r.close();
  }
});

test("edits that cannot be made come back as tool errors; the tools refuse a document that is not a sequence", async () => {
  const r = await rig();
  try {
    const early = await r.call("add_participant", { name: "A" });
    assert.equal(early.isError, true);
    assert.match(early.text, /is a state machine, not a sequence\. Use create_sequence/);

    await r.call("create_sequence", { namespace: "demo", name: "S" });
    await r.call("add_participant", { name: "A" });
    const dup = await r.call("add_participant", { name: "A" });
    assert.equal(dup.isError, true);
    assert.match(dup.text, /already exists/);
    const stranger = await r.call("add_message", { from: "A", to: "Z", label: "hi" });
    assert.equal(stranger.isError, true);
    assert.match(stranger.text, /Participant 'Z' not found/);

    r.host.switchTo(join(r.dir, "data.erdf.json"));
    const onErd = await r.call("add_message", { from: "A", to: "A", label: "x" });
    assert.match(onErd.text, /is an ERD, not a sequence/);
    assert.equal(existsSync(join(r.dir, "data.erdf.json")), false, "nothing written over another type");

    const wrongExt = await r.call("create_sequence", { namespace: "d", name: "x", path: join(r.dir, "x.smdf.json") });
    assert.equal(wrongExt.isError, true);
    assert.match(wrongExt.text, /ends in \.sqdf\.json/);
  } finally {
    await r.close();
  }
});

test("notes live on the sequence, a participant, a message and a fragment; render writes <name>.seq.mmd; load refuses another type", async () => {
  const r = await rig();
  try {
    await r.call("create_sequence", { namespace: "demo", name: "N" });
    await r.call("add_participant", { name: "A", actor: "A" });
    await r.call("add_participant", { name: "B" });
    await r.call("add_message", { from: "A", to: "B", label: "asks", event: "Ask" });
    await r.call("add_fragment", { kind: "opt", label: "sometimes", after: 1, messages: [{ from: "B", to: "A", label: "answers" }] });
    const edits = r.afterEdits.length;

    for (const [target, text] of [
      [undefined, "the whole story"],
      ["A", "a person"],
      ["1", "the question"],
      ["message f1.1", "the answer"],
      ["fragment 1", "only on Tuesdays"],
    ] as const) {
      const saved = await sequenceSetNotes(r.host, target, text);
      assert.equal(saved.isError, undefined, saved.content[0].text);
    }
    assert.equal(r.afterEdits.length, edits, "a note does not ask the system to reconcile");
    const notes = sequenceGetNotes(r.host).content[0].text;
    assert.match(notes, /5 note\(s\) in 'N'/);
    assert.match(notes, /\[diagram\]\nthe whole story/);
    assert.match(notes, /\[message 1\]\nthe question/);
    assert.match(notes, /\[message f1\.1\]\nthe answer/);
    assert.match(notes, /\[fragment 1\]\nonly on Tuesdays/);
    const unknown = await sequenceSetNotes(r.host, "nobody", "x");
    assert.equal(unknown.isError, true);

    const drawn = sequenceRender(r.host, {});
    assert.equal(drawn.isError, undefined, drawn.content[0].text);
    const out = join(r.dir, "N.seq.mmd");
    assert.match(readFileSync(out, "utf8"), /^sequenceDiagram\n  actor p1 as A/);
    assert.equal(sequenceRender(r.host, { format: "png" }).isError, true);

    const refused = await sequenceLoadDefinition(r.host, JSON.stringify({ settings: {}, state: { name: "Root" }, events: [] }));
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /is a sequence, and this JSON is not one/);
  } finally {
    await r.close();
  }
});

test("rename_participant follows it into every message and fragment; move_participant counts columns from 1", async () => {
  const r = await rig();
  try {
    await r.call("create_sequence", { namespace: "demo", name: "R" });
    for (const name of ["A", "B", "C"]) await r.call("add_participant", { name });
    await r.call("add_message", { from: "A", to: "B", label: "one" });
    await r.call("add_message", { from: "C", to: "A", label: "two" });
    await r.call("add_fragment", { kind: "opt", label: "maybe", after: 1, messages: [{ from: "B", to: "A", label: "three" }] });
    const edits = r.afterEdits.length;

    const renamed = await r.call("rename_participant", { name: "A", to: "Alice" });
    assert.match(renamed.text, /^Renamed participant 'A' to 'Alice' in 3 message\(s\)\.\nreconcile: stand-in line$/);
    const def = r.read();
    assert.deepEqual(def.participants.map((p) => p.name), ["Alice", "B", "C"]);
    assert.deepEqual(def.messages.map((m) => [m.from, m.to]), [["Alice", "B"], ["C", "Alice"]]);
    assert.deepEqual([def.fragments![0].messages[0].from, def.fragments![0].messages[0].to], ["B", "Alice"]);
    const taken = await r.call("rename_participant", { name: "B", to: "C" });
    assert.equal(taken.isError, true);
    assert.match(taken.text, /Participant 'C' already exists/);

    const moved = await r.call("move_participant", { name: "C", to: 1 });
    assert.match(moved.text, /^Moved participant 'C' to column 1 of 3\.\nreconcile: stand-in line$/);
    assert.deepEqual(r.read().participants.map((p) => p.name), ["C", "Alice", "B"]);
    const far = await r.call("move_participant", { name: "C", to: 9 });
    assert.match(far.text, /to column 3 of 3/);
    assert.deepEqual(r.read().messages, def.messages, "moving a column leaves the messages alone");
    assert.equal((await r.call("move_participant", { name: "Z", to: 1 })).isError, true);
    assert.equal(r.afterEdits.length, edits + 3, "each successful rename and move asks the system to reconcile");
  } finally {
    await r.close();
  }
});
