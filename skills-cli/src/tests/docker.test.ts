/**
 * docker.test.ts — the flag surface, and the asset that must ship with it.
 *
 * `stateloom docker up` runs a compose file that is mirrored into this package
 * at build time from the repository root. Nothing else in the package imports
 * it, so no compiler and no `files` glob can notice when the mirror does not
 * happen — the failure surfaces as a working CLI that cannot start anything,
 * on somebody else's machine.
 *
 * The flag tests pin the behaviours that are decisions rather than plumbing:
 * which options were actually typed (a default must never overwrite a recorded
 * setting), an unknown option refused rather than ignored, and every shape of
 * `--doc` that compose would otherwise interpolate into silent nonsense.
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dockerAssetsRoot, parseDockerFlags, resolveDocument } from "../docker.js";

test("defaults name the loopback loom, not the network", () => {
  const f = parseDockerFlags([]);
  assert.equal(f.bind, "127.0.0.1");
  assert.equal(f.dir, "./looms");
  assert.equal(f.doc, "statemachine.smdf.json");
  assert.equal(f.project, "stateloom");
  assert.equal(f.wait, true);
  // Nothing was typed, so nothing is pinned — every value here is a default and
  // must lose to whatever the project already recorded.
  assert.equal(f.port, undefined);
  assert.equal(f.given.size, 0);
});

test("only the options actually typed are recorded as given", () => {
  const f = parseDockerFlags(["--port", "5599", "--dir", "/tmp/x"]);
  assert.equal(f.port, 5599);
  assert.deepEqual([...f.given].sort(), ["dir", "port"]);
  // `doc` still has its default value, and that must not read as a choice —
  // this is what stopped `status` from resetting a configured project.
  assert.equal(f.doc, "statemachine.smdf.json");
  assert.equal(f.given.has("doc"), false);
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

// ── --doc, which compose interpolates as /data/${STATELOOM_DOC} ──────────────

test("a bare document name passes through", () => {
  const r = resolveDocument("orders.smdf.json", "/looms", false);
  assert.equal(r.doc, "orders.smdf.json");
  assert.equal(r.dir, "/looms");
});

test("a subdirectory of the mount is allowed", () => {
  assert.equal(resolveDocument("episodes/ep103.smdf.json", "/looms", true).doc, "episodes/ep103.smdf.json");
});

test("an absolute --doc with no --dir chooses the directory", () => {
  const r = resolveDocument("/b/trading/diagrams/main.smdf.json", "./looms", false);
  assert.equal(r.doc, "main.smdf.json");
  assert.equal(r.dir, "/b/trading/diagrams");
  assert.match(r.note ?? "", /documents directory/);
});

test("an absolute --doc under an explicit --dir becomes relative to it", () => {
  const r = resolveDocument("/b/trading/diagrams/sub/main.smdf.json", "/b/trading/diagrams", true);
  assert.equal(r.doc, "sub/main.smdf.json");
  assert.equal(r.dir, "/b/trading/diagrams");
});

// The dangerous one, because before review it WORKED: /data//b/trading/... was
// created inside the mount, seeded empty, and the real diagram sat one
// directory up while the canvas showed a blank machine.
test("an absolute --doc outside an explicit --dir is refused, naming both", () => {
  assert.throws(
    () => resolveDocument("/b/trading/diagrams/main.smdf.json", "/looms", true),
    /is not inside --dir \/looms/,
  );
});

test("a --doc that climbs out of the mount is refused", () => {
  assert.throws(() => resolveDocument("../../etc/passwd.json", "/looms", true), /climbs out/);
});

test("a --doc that is not a .json document is refused", () => {
  assert.throws(() => resolveDocument("machine.yaml", "/looms", false), /must name a .json document/);
});
