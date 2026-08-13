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

// --- relational modality: miadi-chronicle:// addresses (2026-08-07) ---

import { resolveChronicleUri } from "../projectSwitch.js";
import { mkdirSync } from "node:fs";

function fakeChronicle(): { root: string; env: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), "chronicle-"));
  for (const d of [
    "2026-06-28-episode-103-film-preprod-report-phase-2",
    "2026-06-05-episode-011-first",
    "2026-06-06-episode-011-second",
  ]) {
    mkdirSync(join(root, d, "diagrams"), { recursive: true });
  }
  return { root, env: { MIADI_CHRONICLE_ROOT: root } };
}

test("chronicle: number resolves to the episode's diagrams dir, .smdf.json appended", () => {
  const { root, env } = fakeChronicle();
  const p = resolveChronicleUri("miadi-chronicle://103/film-preprod", env);
  assert.equal(
    p,
    join(root, "2026-06-28-episode-103-film-preprod-report-phase-2", "diagrams", "film-preprod.smdf.json"),
  );
  rmSync(root, { recursive: true, force: true });
});

test("chronicle: explicit diagrams segment and full folder name both resolve", () => {
  const { root, env } = fakeChronicle();
  const a = resolveChronicleUri("miadi-chronicle://103/diagrams/film-preprod.smdf.json", env);
  const b = resolveChronicleUri(
    "miadi-chronicle://2026-06-28-episode-103-film-preprod-report-phase-2/film-preprod",
    env,
  );
  assert.equal(a, b);
  rmSync(root, { recursive: true, force: true });
});

test("chronicle: a doubled episode number is a hard error naming both candidates", () => {
  const { root, env } = fakeChronicle();
  assert.throws(
    () => resolveChronicleUri("miadi-chronicle://11/x", env),
    /ambiguous[\s\S]*episode-011-first[\s\S]*episode-011-second/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("chronicle: unknown episode and bare address are named errors; standalone paths untouched", () => {
  const { root, env } = fakeChronicle();
  assert.throws(() => resolveChronicleUri("miadi-chronicle://999/x", env), /no episode matches/);
  assert.throws(() => resolveChronicleUri("miadi-chronicle://onlyone", env), /needs <episode>\/<diagram>/);
  const r = resolveProjectSwitch("/tmp/standalone.smdf.json", "/prev.json");
  assert.equal(r.path, "/tmp/standalone.smdf.json");
  rmSync(root, { recursive: true, force: true });
});
