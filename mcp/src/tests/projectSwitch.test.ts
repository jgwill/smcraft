/**
 * Path power (HANDOFF v2, Phase 2 deliverable 1): the pure logic behind the
 * `set_project_file` MCP tool. An agent may point the loom at any `.json`
 * document path; the switch must absolute-resolve the path, report whether a
 * file is already there (missing is legitimate — create_state_machine writes
 * it next), and refuse non-JSON paths outright.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveProjectSwitch } from "../projectSwitch.js";

test("projectSwitch: relative path resolves absolute and previous is carried", () => {
  const r = resolveProjectSwitch("./some/machine.smdf.json", "/prev/doc.smdf.json");
  assert.equal(r.path, resolve("./some/machine.smdf.json"));
  assert.equal(r.previous, "/prev/doc.smdf.json");
  assert.equal(r.exists, false);
});

test("projectSwitch: reports exists=true for a file already on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-switch-"));
  const file = join(dir, "episode.smdf.json");
  writeFileSync(file, JSON.stringify({ stateMachine: { settings: {}, events: [], state: { name: "Root" } } }));
  try {
    const r = resolveProjectSwitch(file, "/prev/doc.smdf.json");
    assert.equal(r.path, file);
    assert.equal(r.exists, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("projectSwitch: refuses a non-.json path", () => {
  assert.throws(
    () => resolveProjectSwitch("/tmp/machine.yaml", "/prev/doc.smdf.json"),
    /\.json/,
  );
});

test("projectSwitch: switching to the same path is allowed and reports it", () => {
  const r = resolveProjectSwitch("/prev/doc.smdf.json", "/prev/doc.smdf.json");
  assert.equal(r.path, "/prev/doc.smdf.json");
  assert.equal(r.previous, "/prev/doc.smdf.json");
  assert.equal(r.unchanged, true);
});
