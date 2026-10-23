/**
 * The rename's working alias (2026-07-27 brief, item B): every SMCRAFT_* env
 * read gains a STATELOOM_* twin — code reads STATELOOM_* first and falls back
 * to SMCRAFT_*, so the live MCP registration (which bakes SMCRAFT_PROJECT_FILE)
 * keeps working while new deployments speak the loom's own name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { envAlias } from "../env.js";

test("envAlias: STATELOOM_* wins when both twins are set", () => {
  const env = {
    STATELOOM_PROJECT_FILE: "/loom/doc.smdf.json",
    SMCRAFT_PROJECT_FILE: "/old/doc.smdf.json",
  };
  assert.equal(envAlias("PROJECT_FILE", env), "/loom/doc.smdf.json");
});

test("envAlias: falls back to SMCRAFT_* when STATELOOM_* is absent", () => {
  const env = { SMCRAFT_BRIDGE_URL: "http://127.0.0.1:4599" };
  assert.equal(envAlias("BRIDGE_URL", env), "http://127.0.0.1:4599");
});

test("envAlias: undefined when neither twin is set", () => {
  assert.equal(envAlias("BRIDGE_TOKEN", {}), undefined);
});

test("envAlias: empty string counts as set (?? semantics, same as direct reads)", () => {
  const env = { STATELOOM_AGENT_NAME: "", SMCRAFT_AGENT_NAME: "old-agent" };
  assert.equal(envAlias("AGENT_NAME", env), "");
});

test("envAlias: defaults to process.env when no env is passed", () => {
  process.env.STATELOOM_ENV_TEST_PROBE = "alive";
  try {
    assert.equal(envAlias("ENV_TEST_PROBE"), "alive");
  } finally {
    delete process.env.STATELOOM_ENV_TEST_PROBE;
  }
});
