/**
 * Pure render tests — no bridge, no I/O, no clock.
 *
 * A 2-state machine (A --[go]-> B under Root) must render:
 *   - mermaid: a `stateDiagram-v2` containing `A --> B : go`
 *   - ascii:   an indented tree containing `─[go]→ B`, `●`-free when no active
 *              set is supplied, and `●`-marked when a state is active.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { StateMachineDefinition } from "@smcraft/bridge-protocol";
import { renderAscii } from "../render/ascii.js";
import { renderMermaid } from "../render/mermaid.js";

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
