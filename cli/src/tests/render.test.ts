/**
 * Pure render tests — no bridge, no I/O, no clock.
 *
 * A 2-state machine (A --[go]-> B under Root) must render:
 *   - mermaid: a `stateDiagram-v2` containing `A --> B : go`
 *   - ascii:   an indented tree containing `─[go]→ B`, `●`-free when no active
 *              set is supplied, and `●`-marked when a state is active.
 *   - svg:     a standalone document whose viewBox holds every box, whose text
 *              is escaped, and whose nested states are drawn inside their
 *              parent instead of being dropped with the drill-down.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  renderAscii,
  renderMermaid,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";
import { renderSvg } from "../render/svg.js";
import { svgSize } from "../render/raster.js";
import { defaultOutputPath, stampedOutputPath } from "../render/file.js";

const DEF: StateMachineDefinition = {
  settings: { namespace: "demo", name: "m", asynchronous: false },
  events: [{ name: "Internal", events: [{ id: "go" }] }],
  state: {
    name: "Root",
    states: [
      { name: "A", transitions: [{ event: "go", nextState: "B" }] },
      { name: "B" },
    ],
  },
};

test("renderMermaid: stateDiagram-v2 with an A --> B : go edge", () => {
  const out = renderMermaid(DEF);
  assert.ok(out.includes("stateDiagram-v2"), out);
  assert.ok(out.includes("A --> B : go"), out);
});

test("renderAscii: tree with a `─[go]→ B` line and no ● when inactive", () => {
  const out = renderAscii(DEF);
  assert.ok(out.includes("─[go]→ B"), out);
  assert.ok(!out.includes("●"), "no active marker when active set is omitted");
  assert.ok(out.includes("A"), out);
  assert.ok(out.includes("B"), out);
});

test("renderAscii: marks an active state with ●", () => {
  const out = renderAscii(DEF, new Set(["A"]));
  assert.ok(out.includes("● A"), out);
});

test("renderSvg: a standalone document carrying both states and the event", () => {
  const out = renderSvg(DEF);
  assert.ok(out.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), out.slice(0, 80));
  assert.ok(out.trimEnd().endsWith("</svg>"), "document is closed");
  assert.ok(out.includes(">A</text>"), "state A is labelled");
  assert.ok(out.includes(">B</text>"), "state B is labelled");
  assert.ok(out.includes(">go</text>"), "the event chip carries the event id");
  assert.ok(out.includes("marker-end=\"url(#sm-arrow)\""), "the edge is an arrow");
});

test("renderSvg: the viewBox contains every box the layout produced", () => {
  const out = renderSvg(DEF);
  const box = out.match(/viewBox="([-0-9.\s]+)"/);
  assert.ok(box, "a viewBox is declared");
  const [minX, minY, w, h] = box![1].trim().split(/\s+/).map(Number);

  const xs = [...out.matchAll(/<rect x="([-0-9.]+)" y="([-0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)];
  assert.ok(xs.length > 1, "boxes were drawn");
  for (const [, x, y, bw, bh] of xs) {
    assert.ok(Number(x) >= minX, `box left ${x} inside viewBox ${minX}`);
    assert.ok(Number(y) >= minY, `box top ${y} inside viewBox ${minY}`);
    assert.ok(Number(x) + Number(bw) <= minX + w, "box right inside viewBox");
    assert.ok(Number(y) + Number(bh) <= minY + h, "box bottom inside viewBox");
  }
});

test("renderSvg: nested children are drawn inside the parent, not dropped", () => {
  const nested: StateMachineDefinition = {
    settings: { namespace: "demo", name: "m", asynchronous: false },
    events: [{ name: "Internal", events: [{ id: "go" }] }],
    state: {
      name: "Root",
      states: [
        {
          name: "Outer",
          states: [{ name: "Inner", transitions: [{ event: "go", nextState: "Done" }] }, { name: "Done" }],
        },
        { name: "After" },
      ],
    },
  };
  const out = renderSvg(nested);
  assert.ok(out.includes(">Inner</text>"), "the grandchild is on the page");
  assert.ok(out.includes(">Done</text>"), "so is its sibling");
  assert.ok(/<g transform="translate\([-0-9. ]+\) scale\([0-9.]+\)">/.test(out), "as a scaled inset");
});

test("renderSvg: markup in a state name is escaped, not injected", () => {
  const nasty: StateMachineDefinition = {
    settings: { namespace: "demo", name: "m & co", asynchronous: false },
    events: [],
    state: { name: "Root", states: [{ name: "<script>" }, { name: "B" }] },
  };
  const out = renderSvg(nasty);
  assert.ok(!out.includes("<script>"), "no raw tag survives");
  assert.ok(out.includes("&lt;script&gt;"), out);
  assert.ok(out.includes("m &amp; co"), "the title escapes too");
});

test("renderSvg: a self-loop arcs instead of folding through its own box", () => {
  const loop: StateMachineDefinition = {
    settings: { namespace: "demo", name: "m", asynchronous: false },
    events: [{ name: "Internal", events: [{ id: "retry" }] }],
    state: {
      name: "Root",
      states: [{ name: "A", transitions: [{ event: "retry", nextState: "A" }] }, { name: "B" }],
    },
  };
  const out = renderSvg(loop);
  assert.ok(out.includes(">retry</text>"), "the loop is labelled");
  const a = out.match(/<rect x="([-0-9.]+)" y="[-0-9.]+" width="([0-9.]+)"/);
  assert.ok(a, "A has a box");
  const paths = [...out.matchAll(/<path d="M ([-0-9.]+) ([-0-9.]+) C/g)];
  assert.ok(paths.length >= 1, "the loop drew a path");
});

test("renderSvg: light and dark differ, and both are deterministic", () => {
  const dark = renderSvg(DEF);
  const light = renderSvg(DEF, { theme: "light" });
  assert.notEqual(dark, light, "the themes are not the same picture");
  assert.equal(renderSvg(DEF), dark, "the same def renders the same bytes");
});

test("svgSize: reads the declared size, then the viewBox", () => {
  assert.deepEqual(svgSize(renderSvg(DEF)), svgSize(renderSvg(DEF)));
  assert.deepEqual(svgSize('<svg viewBox="0 0 300 150"></svg>'), { width: 300, height: 150 });
  assert.deepEqual(svgSize('<svg width="42" height="7"></svg>'), { width: 42, height: 7 });
});

test("defaultOutputPath: the .smdf.json tail becomes the format's extension", () => {
  assert.ok(defaultOutputPath("/a/statemachine.smdf.json", "png").endsWith("/statemachine.png"));
  assert.ok(defaultOutputPath("/a/board.json", "svg").endsWith("/board.svg"));
  assert.ok(defaultOutputPath("/a/board.smdf.json", "mermaid").endsWith("/board.mmd"));
});

test("stampedOutputPath: a dated name beside the document it drew", () => {
  const at = new Date(2026, 6, 30, 17, 52, 43);
  assert.equal(
    stampedOutputPath("/a/b/board.smdf.json", "OrderFlow", "png", at),
    "/a/b/OrderFlow--260730175243.png"
  );
  assert.equal(
    stampedOutputPath("/srv/2026-07-19-episode-252-x/diagrams/b.smdf.json", "Film", "mermaid", at),
    "/srv/2026-07-19-episode-252-x/diagrams/ep252--Film--260730175243.mmd"
  );
});
