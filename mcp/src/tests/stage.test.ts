/**
 * The stage tools (Spec 83) on a copy of the worked example: a real McpServer
 * and Client over an in-memory transport, a host whose `live` records what
 * would go to the hub and answers a stage's state as a hub would.
 *
 * What it proves: a step goes out with absolute paths and the system its
 * drawing belongs to; a tour is written relative to itself, checked, and
 * played with its paths made absolute; a person's mark is read with what is on
 * their screen, answered as the agent (and shown), and an agent's question is
 * pinned; await_marks returns at the person's next mark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { addMark, type MarksFile, type StageContext } from "@miadi/stateloom-protocol";
import { registerStageTools, type StageHost } from "../stage.js";
import type { Live } from "../live.js";
import { EXAMPLE, MACHINE, SEQUENCE, SYSTEM } from "./systemRig.js";

const ERD = "elliott_wave_count.erdf.json";

async function rig(opts: { context?: StageContext; root?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "loom-stage-"));
  cpSync(EXAMPLE, dir, { recursive: true });
  let active = join(dir, SEQUENCE);
  const sent: { kind: string; env: Record<string, unknown> }[] = [];
  const record = (kind: string) => async (env: unknown) => {
    sent.push({ kind, env: env as Record<string, unknown> });
    return { ok: true, text: `${kind} sent to the hub` };
  };
  const live: Live = {
    patch: async () => ({ ok: true, text: "" }),
    full: async () => ({ ok: true, text: "" }),
    view: async () => ({ ok: true, text: "" }),
    step: record("step"),
    load: record("load"),
    control: record("control"),
    marks: record("marks"),
    stageState: async (stage) => ({ ok: true, text: "read", state: { stage, ...(opts.context ? { context: opts.context } : {}) } }),
  };
  const host: StageHost = {
    projectFile: () => active,
    outsideRoot: (p) => (opts.root && !p.startsWith(dir + "/") ? `Refused: ${p} is outside ${dir}` : undefined),
    live,
    stageName: () => "default",
    agent: () => ({ id: "mia", name: "Mia", role: "agent" }),
    lastSystem: () => join(dir, SYSTEM),
    canvasUrl: (doc) => `http://canvas/?doc=${encodeURIComponent(doc)}`,
  };
  const server = new McpServer({ name: "stage-test", version: "0.0.0" });
  registerStageTools(server, host);
  const client = new Client({ name: "stage-test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    dir,
    sent,
    setActive: (name: string) => {
      active = join(dir, name);
    },
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const content = r.content as { type: string; text?: string }[];
      return { text: content.map((c) => c.text ?? "").join("\n"), isError: r.isError === true };
    },
    close: async () => {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("show_step sends a step with absolute paths and the system the drawing belongs to", async () => {
  const r = await rig();
  try {
    const out = await r.call("show_step", { doc: MACHINE, spotlight: ["state:Reading", "state:Published"], say: "These two states answer the count." });
    assert.equal(out.isError, false, out.text);
    const step = r.sent[0].env.step as Record<string, unknown>;
    assert.equal(r.sent[0].kind, "step");
    assert.equal(r.sent[0].env.stage, "default");
    assert.equal(step.doc, join(r.dir, MACHINE));
    assert.equal(step.system, join(r.dir, SYSTEM), "the system that lists the drawing");
    assert.match(out.text, /http:\/\/canvas\//);

    const bad = await r.call("show_step", { focus: "Reading", say: "x" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /T004/);
  } finally {
    await r.close();
  }
});

test("write_tour stores paths relative to the tour, checks it, and play_tour sends it absolute", async () => {
  const r = await rig();
  try {
    const out = await r.call("write_tour", {
      name: "Why the walk stops",
      namespace: "jgt.trading",
      steps: [
        { doc: SEQUENCE, spotlight: ["message:7"], say: "The scenario asks for a blueprint here." },
        { doc: MACHINE, focus: "state:Published", say: "The machine is not ready for one yet." },
        { doc: ERD, focus: "entity:WaveCount", say: "And this is where the count lives." },
      ],
    });
    assert.equal(out.isError, false, out.text);
    const path = join(r.dir, "Why_the_walk_stops.tour.json");
    assert.ok(existsSync(path));
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(written.steps[0].doc, SEQUENCE, "stored relative to the tour file");
    assert.equal(written.settings.author, "Mia");

    const again = await r.call("write_tour", { name: "Why the walk stops", steps: [{ say: "x" }] });
    assert.equal(again.isError, true, "an existing tour is not replaced without overwrite");

    const played = await r.call("play_tour", { from: 2 });
    assert.equal(played.isError, false, played.text);
    const load = r.sent.find((s) => s.kind === "load")!.env as { tour: { steps: { doc?: string }[] }; from: number; path: string; autoplay: boolean };
    assert.equal(load.from, 1);
    assert.equal(load.autoplay, true);
    assert.equal(load.path, path);
    assert.equal(load.tour.steps[1].doc, join(r.dir, MACHINE));

    const ctl = await r.call("stage_control", { action: "goto", index: 3 });
    assert.equal(ctl.isError, false);
    assert.equal(r.sent.find((s) => s.kind === "control")!.env.index, 2);
    assert.equal((await r.call("stage_control", { action: "goto" })).isError, true);

    const broken = await r.call("write_tour", { name: "bad", steps: [{ say: "", focus: "x" }] });
    assert.equal(broken.isError, true);
    assert.match(broken.text, /T003[\s\S]*T004/);
  } finally {
    await r.close();
  }
});

test("read_marks shows the screen and the marks waiting; answer_mark replies as the agent and shows it", async () => {
  const context: StageContext = { stage: "default", doc: "/x/elliott_wave_count.smdf.json", kind: "machine", focus: "state:Reading", who: "Guillaume", at: "now" };
  const r = await rig({ context });
  try {
    const machine = join(r.dir, MACHINE);
    let file: MarksFile = { doc: MACHINE, marks: [] };
    file = addMark(file, { elements: ["state:Reading"], text: "why does the walk stop here?", author: { id: "g", name: "Guillaume", role: "person" } }, "t", "m-1");
    writeFileSync(machine.replace(/\.json$/, ".marks.json"), JSON.stringify(file));

    const read = await r.call("read_marks");
    assert.equal(read.isError, false, read.text);
    assert.match(read.text, /Guillaume is on elliott_wave_count\.smdf\.json \(machine\), with state:Reading in hand/);
    assert.match(read.text, /\[open · comment\] Guillaume on state:Reading \(elliott_wave_count\.smdf\.json\) — m-1/);
    assert.match(read.text, /Scope: 3 drawings/, "the active sequence's system is the scope: its three members");

    const answered = await r.call("answer_mark", { id: "m-1", text: "The guard reads wave_label, which the count has not set.", show: true });
    assert.equal(answered.isError, false, answered.text);
    const stored = JSON.parse(readFileSync(machine.replace(/\.json$/, ".marks.json"), "utf8")) as MarksFile;
    assert.equal(stored.marks[0].status, "answered");
    assert.equal(stored.marks[0].replies?.[0].author.role, "agent");
    const marksPush = r.sent.find((s) => s.kind === "marks")!.env;
    assert.equal(marksPush.docId, machine);
    const shown = r.sent.find((s) => s.kind === "step")!.env.step as { spotlight: string[]; doc: string };
    assert.deepEqual(shown.spotlight, ["state:Reading"]);
    assert.equal(shown.doc, machine);

    const quiet = await r.call("read_marks");
    assert.match(quiet.text, /No marks\./, "an answered mark waits on the person, not the agent");
    const all = await r.call("read_marks", { all: true });
    assert.match(all.text, /↳ Mia \(agent\)/);

    assert.equal((await r.call("answer_mark", { id: "m-nope", text: "x" })).isError, true);
    const closed = await r.call("answer_mark", { id: "m-1", resolve: true });
    assert.equal(closed.isError, false);
    assert.equal((JSON.parse(readFileSync(machine.replace(/\.json$/, ".marks.json"), "utf8")) as MarksFile).marks[0].status, "resolved");
  } finally {
    await r.close();
  }
});

test("add_mark pins the agent's question; await_marks returns at the person's next mark", async () => {
  const r = await rig();
  try {
    r.setActive(ERD);
    const added = await r.call("add_mark", { elements: ["entity:WaveCount"], text: "Should a count keep its history?" });
    assert.equal(added.isError, false, added.text);
    const sidecar = join(r.dir, ERD).replace(/\.json$/, ".marks.json");
    const file = JSON.parse(readFileSync(sidecar, "utf8")) as MarksFile;
    assert.equal(file.marks[0].kind, "question");
    assert.equal(file.marks[0].author.role, "agent");

    const waiting = r.call("await_marks", { timeoutSeconds: 10, doc: join(r.dir, ERD) });
    setTimeout(() => {
      const next = addMark(file, { elements: ["attribute:WaveCount.wave_label"], text: "yes, every relabel", author: { id: "g", name: "Guillaume", role: "person" } }, "t2", "m-2");
      writeFileSync(sidecar, JSON.stringify(next));
    }, 1300);
    const heard = await waiting;
    assert.equal(heard.isError, false, heard.text);
    assert.match(heard.text, /The person marked something/);
    assert.match(heard.text, /yes, every relabel/);
    assert.doesNotMatch(heard.text, /Should a count keep its history/, "the agent's own question is not news");

    const timeout = await r.call("await_marks", { timeoutSeconds: 1, doc: join(r.dir, ERD) });
    assert.match(timeout.text, /No new mark in 1s/);
  } finally {
    await r.close();
  }
});

test("a confined server refuses a drawing outside its root", async () => {
  const r = await rig({ root: true });
  try {
    const out = await r.call("show_step", { doc: "/etc/elsewhere.smdf.json", say: "x" });
    assert.equal(out.isError, true);
    assert.match(out.text, /Refused/);
    assert.equal((await r.call("read_marks", { doc: "/etc/x.smdf.json" })).isError, true);
  } finally {
    await r.close();
  }
});
