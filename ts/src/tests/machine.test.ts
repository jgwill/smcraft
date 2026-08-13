/**
 * Drive-path contract tests for the SMDF interpreter (Machine).
 *
 * These tests lock the API consumed by external tools (forgewright's
 * runtime bridge and graph ingest): create machine from SMDF → initial
 * state → send event → state advances; transition enumeration; parser +
 * codegen round-trip for STC-seeded machines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { StateMachineDefinition } from "../model.js";
import { Machine, MachineDefinitionError, listTransitions } from "../machine.js";
import { enrich, parseJson, validate } from "../parser.js";
import { TypeScriptCodeGenerator } from "../codegen.js";
import type { IObserver } from "../runtime.js";

// --- Fixtures ---

/** Flat workflow — the shape forgewright's graph tests ingest. */
function makeWorkflow(): StateMachineDefinition {
  return {
    settings: { namespace: "test.workflow", name: "TestWorkflow", asynchronous: false },
    events: [
      {
        name: "user-input",
        events: [
          { id: "start", name: "start" },
          { id: "complete", name: "complete" },
        ],
      },
    ],
    state: {
      name: "root",
      states: [
        { name: "idle", transitions: [{ event: "start", nextState: "running" }] },
        { name: "running", transitions: [{ event: "complete", nextState: "done" }] },
        { name: "done", kind: "final" },
      ],
    },
  };
}

/**
 * STC-seeded machine — mirrors forgewright's stcToSMDF output:
 * phases as composite states, steps as leaves, a root-level
 * tension_established transition targeting the initial leaf, internal
 * ai_generate/user_edit events, and a final step that (illegitimately,
 * per V007) still carries transitions.
 */
function makeStcMachine(): StateMachineDefinition {
  return {
    settings: { namespace: "forgewright.stc", name: "STC_test", asynchronous: true },
    events: [
      {
        name: "STCEvents",
        events: [
          { id: "tension_established", name: "Tension Established" },
          { id: "action_step_completed", name: "Action Step Completed" },
          { id: "phase_advance", name: "Phase Advance" },
          { id: "tension_resolve", name: "Tension Resolve" },
          { id: "ai_generate", name: "AI Generate" },
          { id: "user_edit", name: "User Edit" },
        ],
      },
    ],
    state: {
      name: "CreativeProcess",
      transitions: [
        { event: "tension_established", nextState: "StepVision" },
      ],
      states: [
        {
          name: "Germination",
          states: [
            {
              name: "StepVision",
              transitions: [
                { event: "phase_advance", nextState: "StepResearch" },
                { event: "ai_generate" },
                { event: "user_edit" },
              ],
            },
          ],
        },
        {
          name: "Assimilation",
          states: [
            {
              name: "StepResearch",
              transitions: [
                { event: "action_step_completed", nextState: "StepBuild" },
                { event: "ai_generate" },
              ],
            },
            {
              name: "StepBuild",
              transitions: [
                { event: "phase_advance", nextState: "StepReview" },
                {
                  event: "action_step_completed",
                  condition: "step_research_complete",
                  nextState: "StepReview",
                },
              ],
            },
          ],
        },
        {
          name: "Completion",
          states: [
            {
              name: "StepReview",
              kind: "final",
              transitions: [{ event: "tension_resolve" }],
            },
          ],
        },
      ],
    },
  };
}

// --- Drive path ---

describe("Machine: drive path", () => {
  it("enters the initial leaf state on construction", () => {
    const machine = new Machine(makeWorkflow());
    assert.equal(machine.state, "idle");
    assert.deepEqual(machine.path, ["root", "idle"]);
    assert.equal(machine.done, false);
    assert.deepEqual(machine.visited, ["idle"]);
  });

  it("advances state when an event is sent", () => {
    const machine = new Machine(makeWorkflow());

    const r1 = machine.send("start");
    assert.equal(r1.handled, true);
    assert.equal(r1.changed, true);
    assert.equal(r1.from, "idle");
    assert.equal(r1.to, "running");
    assert.equal(machine.state, "running");

    const r2 = machine.send("complete");
    assert.equal(r2.changed, true);
    assert.equal(machine.state, "done");
    assert.deepEqual(machine.visited, ["idle", "running", "done"]);
  });

  it("ends the machine on a final state and rejects later sends", () => {
    const machine = new Machine(makeWorkflow());
    machine.send("start");
    machine.send("complete");
    assert.equal(machine.done, true);

    const r = machine.send("start");
    assert.equal(r.handled, false);
    assert.equal(r.changed, false);
    assert.match(r.error ?? "", /final/);
  });

  it("reports unhandled events without changing state", () => {
    const machine = new Machine(makeWorkflow());
    const r = machine.send("complete"); // not valid from idle
    assert.equal(r.handled, false);
    assert.equal(r.changed, false);
    assert.equal(machine.state, "idle");
    assert.match(r.error ?? "", /no transition/);
  });

  it("exposes can() and availableEvents() without side effects", () => {
    const machine = new Machine(makeWorkflow());
    assert.equal(machine.can("start"), true);
    assert.equal(machine.can("complete"), false);
    assert.deepEqual(machine.availableEvents(), ["start"]);
    assert.equal(machine.state, "idle");
  });
});

// --- Hierarchical semantics (STC-shaped) ---

describe("Machine: hierarchical STC semantics", () => {
  it("enters the deepest initial leaf of a hierarchical machine", () => {
    const machine = new Machine(makeStcMachine());
    assert.equal(machine.state, "StepVision");
    assert.deepEqual(machine.path, ["CreativeProcess", "Germination", "StepVision"]);
  });

  it("resolves ancestor transitions targeting the current state as internal (handled, unchanged)", () => {
    const machine = new Machine(makeStcMachine());
    // Root declares tension_established → StepVision; machine is already there.
    const r = machine.send("tension_established");
    assert.equal(r.handled, true);
    assert.equal(r.changed, false, "self-target must not advance the state");
    assert.equal(r.from, "StepVision");
    assert.equal(r.to, "StepVision");
    assert.equal(machine.state, "StepVision");
  });

  it("crosses composite boundaries with correct exit/entry ordering", () => {
    const log: string[] = [];
    const observer: IObserver = {
      onEntry: (_c, s) => log.push(`enter:${s}`),
      onExit: (_c, s) => log.push(`exit:${s}`),
      onTransitionBegin: () => {},
      onTransitionEnd: () => {},
      onTimerStart: () => {},
      onTimerStop: () => {},
    };
    const machine = new Machine(makeStcMachine(), { observer });

    log.length = 0;
    const r = machine.send("phase_advance");
    assert.equal(r.to, "StepResearch");
    assert.deepEqual(log, [
      "exit:StepVision",
      "exit:Germination",
      "enter:Assimilation",
      "enter:StepResearch",
    ]);
  });

  it("treats transitions without nextState as internal", () => {
    const machine = new Machine(makeStcMachine());
    const r = machine.send("ai_generate");
    assert.equal(r.handled, true);
    assert.equal(r.changed, false);
    assert.equal(machine.state, "StepVision");
  });

  it("skips guarded transitions unless the guard context satisfies them", () => {
    const machine = new Machine(makeStcMachine());
    machine.send("phase_advance"); // → StepResearch
    machine.send("action_step_completed"); // → StepBuild

    // StepBuild's guarded action_step_completed requires step_research_complete.
    const blocked = machine.send("action_step_completed");
    assert.equal(blocked.handled, false);
    assert.equal(machine.state, "StepBuild");

    const unlocked = new Machine(makeStcMachine(), {
      context: { step_research_complete: true },
    });
    unlocked.send("phase_advance");
    unlocked.send("action_step_completed");
    const taken = unlocked.send("action_step_completed");
    assert.equal(taken.handled, true);
    assert.equal(taken.to, "StepReview");
    assert.equal(unlocked.done, true, "StepReview is final");
  });

  it("descends into composite targets down to their initial leaf", () => {
    const def = makeStcMachine();
    // Repoint root transition at the Assimilation composite.
    def.state.transitions = [{ event: "tension_established", nextState: "Assimilation" }];
    const machine = new Machine(def);
    const r = machine.send("tension_established");
    assert.equal(r.changed, true);
    assert.equal(r.to, "StepResearch");
    assert.deepEqual(machine.path, ["CreativeProcess", "Assimilation", "StepResearch"]);
  });

  it("surfaces V007 (final state with transitions) as a warning, not a failure", () => {
    const machine = new Machine(makeStcMachine());
    assert.ok(machine.warnings.some((w) => w.ruleId === "V007"));
  });

  it("rejects definitions with fatal structural errors", () => {
    const def = makeWorkflow();
    def.state.states![0].transitions = [{ event: "start", nextState: "nowhere" }];
    assert.throws(() => new Machine(def), MachineDefinitionError);
  });

  it("supports serialize/setState round-trip for persistence", () => {
    const machine = new Machine(makeWorkflow());
    machine.send("start");
    const snapshot = machine.serialize();
    assert.deepEqual(snapshot, { state: "running" });

    const restored = new Machine(makeWorkflow());
    restored.deserialize(snapshot);
    assert.equal(restored.state, "running");
    assert.throws(() => restored.setState("nowhere"), /Unknown state/);
  });
});

// --- Transition enumeration (graph-ingest contract) ---

describe("listTransitions", () => {
  it("enumerates flat workflow transitions as from/event/to edges", () => {
    const edges = listTransitions(makeWorkflow());
    assert.deepEqual(
      edges.map((e) => `${e.from}--${e.event}-->${e.to}`),
      ["idle--start-->running", "running--complete-->done"],
    );
    assert.ok(edges.every((e) => !e.internal));
  });

  it("includes transitions declared on composite/root states", () => {
    const edges = listTransitions(makeStcMachine());
    const rootEdge = edges.find((e) => e.from === "CreativeProcess");
    assert.ok(rootEdge, "root-level transition must be enumerated");
    assert.equal(rootEdge!.event, "tension_established");
    assert.equal(rootEdge!.to, "StepVision");
  });

  it("surfaces internal transitions as self-edges", () => {
    const edges = listTransitions(makeStcMachine());
    const internal = edges.filter((e) => e.internal);
    assert.ok(internal.length >= 2, "ai_generate/user_edit/tension_resolve are internal");
    assert.ok(internal.every((e) => e.from === e.to));
  });

  it("preserves guard conditions on edges", () => {
    const edges = listTransitions(makeStcMachine());
    const guarded = edges.find((e) => e.condition === "step_research_complete");
    assert.ok(guarded);
    assert.equal(guarded!.from, "StepBuild");
    assert.equal(guarded!.to, "StepReview");
  });
});

// --- Parser + codegen round-trip for STC-seeded machines ---

describe("STC-seeded machine: parser + codegen round-trip", () => {
  it("survives JSON round-trip and re-interpretation", () => {
    const def = parseJson(JSON.stringify(makeStcMachine()));
    const machine = new Machine(def);
    machine.send("phase_advance");
    assert.equal(machine.state, "StepResearch");

    const model = enrich(def);
    assert.equal(model.allStates.length, 8);
    assert.equal(model.leafStates.length, 4);
    assert.equal(model.eventMap.size, 6);
  });

  it("validates with only the known V007 finding", () => {
    const model = enrich(makeStcMachine());
    const errors = validate(model);
    assert.deepEqual(
      errors.map((e) => e.ruleId),
      ["V007"],
      `unexpected findings: ${JSON.stringify(errors)}`,
    );
  });

  it("generates TypeScript code for the STC-seeded machine", () => {
    const model = enrich(makeStcMachine());
    const code = new TypeScriptCodeGenerator(model).generate();

    assert.ok(code.includes("STC_testStateEnum"), "state enum");
    assert.ok(code.includes("class StateStepVision"), "leaf state class");
    assert.ok(code.includes("onPhaseAdvance"), "event handler");
    assert.ok(code.includes("STC_testContext"), "context class");
    assert.ok(code.includes("enterInitialState"), "initial state entry");
  });

  it("keeps interpreter and enumeration consistent", () => {
    const def = makeStcMachine();
    const edges = listTransitions(def);
    const machine = new Machine(def, { context: { step_research_complete: true } });

    // Every edge reachable from the current chain must be sendable.
    for (const e of edges.filter((x) => x.from === machine.state && !x.condition)) {
      assert.equal(machine.can(e.event), true, `can(${e.event}) from ${machine.state}`);
    }
  });
});

// --- Timers ---

describe("Machine: timers", () => {
  it("starts and stops timers from actions and fires the timer event", async () => {
    const def: StateMachineDefinition = {
      settings: { namespace: "test.timers", name: "TimerMachine", asynchronous: false },
      events: [
        {
          name: "timed",
          events: [{ id: "begin" }],
          timers: [{ id: "timeout_evt", name: "Timeout" }],
        },
      ],
      state: {
        name: "Root",
        states: [
          { name: "Waiting", transitions: [{ event: "begin", nextState: "Armed" }] },
          {
            name: "Armed",
            onEntry: { actions: [{ timerStart: { timer: "Timeout", duration: "10" } }] },
            onExit: { actions: [{ timerStop: "Timeout" }] },
            transitions: [{ event: "timeout_evt", nextState: "Expired" }],
          },
          { name: "Expired", kind: "final" },
        ],
      },
    };

    const machine = new Machine(def);
    machine.send("begin");
    assert.equal(machine.state, "Armed");

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(machine.state, "Expired");
    assert.equal(machine.done, true);
  });
});
