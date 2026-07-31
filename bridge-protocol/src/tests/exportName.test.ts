/**
 * What an exported diagram is called.
 *
 * The name carries three things and must keep carrying them: the episode when
 * the document lives in one, the machine it draws, and a `yyMMddHHmmss` stamp
 * so a second export never lands on the first. The clock is an argument, so
 * these assertions are exact rather than approximate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramFileName, episodeOf, timeStamp } from "../exportName.js";

const AT = new Date(2026, 6, 30, 17, 52, 43); // 2026-07-30 17:52:43 local

test("timeStamp: yyMMddHHmmss, every field padded", () => {
  assert.equal(timeStamp(AT), "260730175243");
  assert.equal(timeStamp(new Date(2026, 0, 5, 4, 3, 2)), "260105040302");
});

test("episodeOf: reads the chronicle folder, and nothing that isn't one", () => {
  assert.equal(
    episodeOf("/srv/miadi/episodes/miadi-chronicle/2026-07-19-episode-252-sparrow/diagrams/a.smdf.json"),
    "ep252"
  );
  assert.equal(episodeOf("/srv/miadi/ep103/diagrams/film-preprod.smdf.json"), "ep103");
  assert.equal(episodeOf("/workspace/repos/jgwill/smcraft/statemachine.smdf.json"), null);
  assert.equal(episodeOf("statemachine.smdf.json"), null);
});

test("diagramFileName: episode, machine and stamp, in that order", () => {
  assert.equal(
    diagramFileName({
      doc: "/srv/miadi/episodes/miadi-chronicle/2026-07-19-episode-252-sparrow/diagrams/board.smdf.json",
      machine: "InteractiveProduction",
      format: "svg",
      at: AT,
    }),
    "ep252--InteractiveProduction--260730175243.svg"
  );
});

test("diagramFileName: no episode means no prefix", () => {
  assert.equal(
    diagramFileName({ doc: "/tmp/board.smdf.json", machine: "Shoot", format: "png", at: AT }),
    "Shoot--260730175243.png"
  );
});

test("diagramFileName: falls back to the document, then to a default", () => {
  assert.equal(
    diagramFileName({ doc: "/tmp/order-workflow.smdf.json", format: "mmd", at: AT }),
    "order-workflow--260730175243.mmd"
  );
  assert.equal(diagramFileName({ format: "md", at: AT }), "statemachine--260730175243.md");
});

test("diagramFileName: a machine name is made safe to write to disk", () => {
  assert.equal(
    diagramFileName({ machine: "Order / Fulfilment  ✱ v2", format: "png", at: AT }),
    "Order-Fulfilment-v2--260730175243.png"
  );
  const long = diagramFileName({ machine: "N".repeat(200), format: "png", at: AT });
  assert.ok(long.length < 100, `capped, got ${long.length}`);
  assert.ok(long.endsWith("--260730175243.png"), long);
});
