/**
 * Mermaid rendering, with the nesting rule under guard.
 *
 * Mermaid decides what sits inside a composite by where a state is first
 * mentioned, not by what the block declares. The renderer used to open
 * `state Shooting { }` and then write its children's edges at the top level,
 * which draws an empty box with the children stranded outside it. These tests
 * pin the fix: an edge is written at the level of the state it leaves, and
 * every state gets mentioned somewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMermaid } from "../render/mermaid.js";
import type { StateMachineDefinition } from "../definition.js";

const NESTED: StateMachineDefinition = {
  settings: { namespace: "demo", name: "NestedShoot", asynchronous: false },
  events: [],
  state: {
    name: "Root",
    states: [
      { name: "Prep", transitions: [{ event: "START", nextState: "Shooting" }] },
      {
        name: "Shooting",
        transitions: [{ event: "WRAP", nextState: "Wrapped" }],
        states: [
          { name: "Setup", transitions: [{ event: "ROLL", nextState: "Rolling" }] },
          { name: "Rolling", transitions: [{ event: "CUT", nextState: "Checking" }] },
          { name: "Checking", transitions: [{ event: "RETAKE", nextState: "Setup" }] },
        ],
      },
      { name: "Wrapped", kind: "final" },
    ],
  },
};

/** The lines between `state <name> {` and its closing brace. */
function blockOf(mermaid: string, name: string): string[] {
  const lines = mermaid.split("\n");
  const open = lines.findIndex((l) => l.trim() === `state ${name} {`);
  assert.ok(open >= 0, `no block for ${name} in:\n${mermaid}`);
  const depth = lines[open].length - lines[open].trimStart().length;
  const close = lines.findIndex((l, i) => i > open && l.trim() === "}" && l.length - l.trimStart().length === depth);
  assert.ok(close > open, `unclosed block for ${name}`);
  return lines.slice(open + 1, close).map((l) => l.trim());
}

test("renderMermaid: a composite's children live inside its block", () => {
  const out = renderMermaid(NESTED);
  const inside = blockOf(out, "Shooting");
  assert.deepEqual(inside, [
    "Setup --> Rolling : ROLL",
    "Rolling --> Checking : CUT",
    "Checking --> Setup : RETAKE",
  ]);
});

test("renderMermaid: the parent's own edges stay outside its block", () => {
  const out = renderMermaid(NESTED);
  const top = out.split("\n").filter((l) => l.startsWith("    ") && !l.startsWith("        "));
  assert.ok(top.some((l) => l.trim() === "Prep --> Shooting : START"), out);
  assert.ok(top.some((l) => l.trim() === "Shooting --> Wrapped : WRAP"), out);
  assert.ok(!blockOf(out, "Shooting").some((l) => l.includes("Prep")), "Prep is not inside Shooting");
});

test("renderMermaid: a state no edge names is still declared", () => {
  const lonely: StateMachineDefinition = {
    settings: { namespace: "demo", name: "m", asynchronous: false },
    events: [],
    state: { name: "Root", states: [{ name: "Alone" }, { name: "AlsoAlone" }] },
  };
  const out = renderMermaid(lonely);
  assert.ok(out.includes("\n    Alone"), out);
  assert.ok(out.includes("\n    AlsoAlone"), out);
});

test("renderMermaid: guards ride the label, targetless transitions draw nothing", () => {
  const guarded: StateMachineDefinition = {
    settings: { namespace: "demo", name: "m", asynchronous: false },
    events: [],
    state: {
      name: "Root",
      states: [
        {
          name: "A",
          transitions: [
            { event: "go", nextState: "B", condition: "ready" },
            { event: "ping" },
          ],
        },
        { name: "B" },
      ],
    },
  };
  const out = renderMermaid(guarded);
  assert.ok(out.includes("A --> B : go [ready]"), out);
  assert.ok(!out.includes("ping"), "a transition with no target has no edge to draw");
});

test("renderMermaid: deterministic", () => {
  assert.equal(renderMermaid(NESTED), renderMermaid(NESTED));
});
