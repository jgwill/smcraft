/**
 * docker.test.ts — the flag surface, and the asset that must ship with it.
 *
 * `stateloom docker up` runs a compose file that is mirrored into this package
 * at build time from the repository root. Nothing else in the package imports
 * it, so no compiler and no `files` glob can notice when the mirror does not
 * happen — the failure surfaces as a working CLI that cannot start anything,
 * on somebody else's machine.
 *
 * The flag tests pin the two behaviours that are decisions rather than
 * plumbing: an explicit port is never silently moved, and an unknown option is
 * refused rather than ignored.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dockerAssetsRoot, parseDockerFlags } from "../docker.js";

test("defaults name the loopback loom, not the network", () => {
  const f = parseDockerFlags([]);
  assert.equal(f.bind, "127.0.0.1");
  assert.equal(f.dir, "./looms");
  assert.equal(f.doc, "statemachine.smdf.json");
  assert.equal(f.project, "stateloom");
  assert.equal(f.wait, true);
  // No port asked for — the caller gets whatever is free, and that is recorded
  // as "not explicit" so the chooser is allowed to move it.
  assert.equal(f.port, undefined);
  assert.equal(f.portExplicit, false);
});

test("an explicit port is marked explicit, so it is never silently moved", () => {
  const f = parseDockerFlags(["--port", "5599"]);
  assert.equal(f.port, 5599);
  assert.equal(f.portExplicit, true);
});

test("a port that is not a port is refused at parse time", () => {
  assert.throws(() => parseDockerFlags(["--port", "http"]), /not a port number/);
  assert.throws(() => parseDockerFlags(["--port", "70000"]), /not a port number/);
});

test("an option that needs a value and has none is refused", () => {
  assert.throws(() => parseDockerFlags(["--dir"]), /--dir needs a value/);
});

test("an unknown option is an error, not a shrug", () => {
  assert.throws(() => parseDockerFlags(["--porrt", "5599"]), /unknown option: --porrt/);
});

test("bare words are positional — `logs canvas` names a service", () => {
  const f = parseDockerFlags(["canvas"]);
  assert.deepEqual(f.positional, ["canvas"]);
});

test("the compose file is bundled, and it is the four-service loom", () => {
  const compose = join(dockerAssetsRoot(), "docker-compose.yml");
  assert.ok(
    existsSync(compose),
    `missing ${compose} — scripts/sync-docker.mjs did not run, and \`stateloom docker up\` would have nothing to start`,
  );
  const text = readFileSync(compose, "utf8");
  for (const service of ["hub:", "mcp:", "canvas:", "gateway:"]) {
    assert.match(text, new RegExp(`^\\s{2}${service}`, "m"), `no ${service} service`);
  }
  // The one line the whole containerised design rests on. If this stops being
  // "/", the canvas is being handed an address that has to be right for the
  // browser, and the class of failure this design deletes comes back.
  assert.match(text, /STATELOOM_BRIDGE_URL:\s*"\/"/, 'the canvas must be pointed at "/"');
  // Only the gateway may publish a port.
  assert.equal((text.match(/^\s{4}ports:/gm) ?? []).length, 1, "exactly one service publishes a port");
});
