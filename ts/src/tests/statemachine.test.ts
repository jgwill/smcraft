/**
 * End-to-end tests for the SMCraft State Machine Framework (TypeScript).
 *
 * Tests the full pipeline: definition → parse → validate → generate → run.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseJson,
  enrich,
  validate,
  type EnrichedModel,
} from "../parser.js";
import {
  Context,
  ContextBase,
  State,
  StateKind,
  TransitionHelper,
  ObserverConsole,
  ObserverNull,
  type IObserver,
} from "../runtime.js";
import { TypeScriptCodeGenerator } from "../codegen.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "..", "..", "examples");
const BDBO_JSON_PATH = join(EXAMPLES_DIR, "bdbo_strategy.smdf.json");

function loadBdboModel(): EnrichedModel {
  const content = readFileSync(BDBO_JSON_PATH, "utf-8");
  const definition = parseJson(content);
  return enrich(definition);
}

describe("Parser", () => {
  it("should parse BDBO strategy JSON", () => {
    const model = loadBdboModel();
    assert.equal(model.definition.settings.name, "BDBOStrategy");
    assert.equal(model.definition.settings.namespace, "Trading.Strategies");
    assert.equal(model.definition.settings.asynchronous, false);
    assert.equal(model.allStates.length, 8);
    assert.equal(model.leafStates.length, 6);
    assert.equal(model.eventMap.size, 7); // 6 events + 1 timer
    assert.ok(model.feedersMap.has("StrategyFeeder"));
  });

  it("should build parent map correctly", () => {
    const model = loadBdboModel();
    assert.equal(model.parentMap.get("Root"), null);
    assert.equal(model.parentMap.get("Idle"), "Root");
    assert.equal(model.parentMap.get("Active"), "Root");
    assert.equal(model.parentMap.get("Active_WaitingBreakout"), "Active");
  });
});

describe("Validation", () => {
  it("should pass validation for valid definitions", () => {
    const model = loadBdboModel();
    const errors = validate(model);
    assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
  });

  it("should catch duplicate state names", () => {
    const badJson = JSON.stringify({
      settings: { namespace: "Test", asynchronous: false },
      events: [{ name: "TestEvents", events: [{ id: "go" }] }],
      state: {
        name: "Root",
        states: [
          { name: "A", transitions: [{ event: "go", nextState: "A" }] },
          { name: "A" }, // Duplicate
        ],
      },
    });
    const definition = parseJson(badJson);
    const model = enrich(definition);
    const errors = validate(model);
    const ruleIds = new Set(errors.map((e) => e.ruleId));
    assert.ok(ruleIds.has("V002"), "Should catch duplicate state names");
  });

  it("should catch undefined event references", () => {
    const badJson = JSON.stringify({
      settings: { namespace: "Test", asynchronous: false },
      events: [{ name: "TestEvents", events: [{ id: "go" }] }],
      state: {
        name: "Root",
        states: [
          { name: "A", transitions: [{ event: "nonexistent", nextState: "B" }] },
          { name: "B" },
        ],
      },
    });
    const definition = parseJson(badJson);
    const model = enrich(definition);
    const errors = validate(model);
    const ruleIds = new Set(errors.map((e) => e.ruleId));
    assert.ok(ruleIds.has("V005"), "Should catch undefined event");
  });

  it("should catch final states with transitions", () => {
    const badJson = JSON.stringify({
      settings: { namespace: "Test", asynchronous: false },
      events: [{ name: "TestEvents", events: [{ id: "go" }] }],
      state: {
        name: "Root",
        states: [
          { name: "A" },
          { name: "B", kind: "final", transitions: [{ event: "go" }] },
        ],
      },
    });
    const definition = parseJson(badJson);
    const model = enrich(definition);
    const errors = validate(model);
    const ruleIds = new Set(errors.map((e) => e.ruleId));
    assert.ok(ruleIds.has("V007"), "Should catch final state with transitions");
  });
});

describe("Runtime", () => {
  it("should process basic transitions", () => {
    const root = new State("Root", StateKind.ROOT);
    const idle = new State("Idle", StateKind.LEAF, root);
    const active = new State("Active", StateKind.LEAF, root);
    const done = new State("Done", StateKind.FINAL, root);

    const ctx = new Context("TestContext");
    ctx.stateCurrent = idle;

    const log: string[] = [];
    const observer: IObserver = {
      onEntry: (_cn, sn) => log.push(`enter:${sn}`),
      onExit: (_cn, sn) => log.push(`exit:${sn}`),
      onTransitionBegin: (_cn, sp, sn) => log.push(`begin:${sp}->${sn}`),
      onTransitionEnd: (_cn, sp, sn) => log.push(`end:${sp}->${sn}`),
      onTimerStart: () => {},
      onTimerStop: () => {},
    };
    ctx.setObserver(observer);

    // Idle -> Active
    TransitionHelper.processTransitionBegin(ctx, idle, active, "Activate");
    ctx.stateCurrent = active;
    TransitionHelper.processTransitionEnd(ctx, idle, active);

    assert.equal(ctx.stateCurrent, active);
    assert.ok(log.includes("exit:Idle"));
    assert.ok(log.includes("enter:Active"));
    assert.ok(log.includes("begin:Idle->Active"));
    assert.ok(log.includes("end:Idle->Active"));

    // Active -> Done (final triggers end handler)
    const ended: boolean[] = [];
    ctx.registerEndHandler(() => ended.push(true));
    TransitionHelper.processTransitionBegin(ctx, active, done, "Complete");
    ctx.stateCurrent = done;
    TransitionHelper.processTransitionEnd(ctx, active, done);

    assert.equal(ctx.stateCurrent, done);
    assert.equal(ended.length, 1, "End handler should fire on final state");
  });

  it("should handle hierarchical state transitions", () => {
    const root = new State("Root", StateKind.ROOT);
    const parentA = new State("ParentA", StateKind.COMPOSITE, root);
    const childA1 = new State("ChildA1", StateKind.LEAF, parentA);
    const parentB = new State("ParentB", StateKind.COMPOSITE, root);
    const childB1 = new State("ChildB1", StateKind.LEAF, parentB);

    const ctx = new Context("HierTest");
    ctx.stateCurrent = childA1;

    const log: string[] = [];
    const observer: IObserver = {
      onEntry: (_cn, sn) => log.push(`enter:${sn}`),
      onExit: (_cn, sn) => log.push(`exit:${sn}`),
      onTransitionBegin: () => {},
      onTransitionEnd: () => {},
      onTimerStart: () => {},
      onTimerStop: () => {},
    };
    ctx.setObserver(observer);

    // Cross-branch: ChildA1 -> ChildB1
    TransitionHelper.processTransitionBegin(ctx, childA1, childB1, "CrossBranch");
    ctx.stateCurrent = childB1;
    TransitionHelper.processTransitionEnd(ctx, childA1, childB1);

    assert.ok(log.includes("exit:ChildA1"));
    assert.ok(log.includes("exit:ParentA"));
    assert.ok(log.includes("enter:ParentB"));
    assert.ok(log.includes("enter:ChildB1"));

    const exitA1Idx = log.indexOf("exit:ChildA1");
    const enterB1Idx = log.indexOf("enter:ChildB1");
    assert.ok(exitA1Idx < enterB1Idx, "Exit should happen before enter");
  });

  it("should serialize and deserialize state", () => {
    const root = new State("Root", StateKind.ROOT);
    const _idle = new State("Idle", StateKind.LEAF, root);
    const active = new State("Active", StateKind.LEAF, root);

    const ctx = new Context("SerTest");
    ctx.stateCurrent = active;

    const data = ctx.serialize();
    assert.equal(data.state, "Active");
  });

  it("should support timers", () => {
    const ctx = new Context("TimerTest");
    let fired = false;

    ctx.startTimer("test", 50, () => { fired = true; });
    ctx.stopTimer("test");
    assert.equal(fired, false);
  });
});

describe("Code Generator", () => {
  it("should generate TypeScript code from BDBO definition", () => {
    const model = loadBdboModel();
    const generator = new TypeScriptCodeGenerator(model);
    const code = generator.generate();

    assert.ok(code.includes("BDBOStrategyStateEnum"), "Should have state enum");
    assert.ok(code.includes("StateBDBOStrategy"), "Should have base state class");
    assert.ok(code.includes("StateIdle"), "Should have Idle state class");
    assert.ok(code.includes("BDBOStrategyContext"), "Should have context class");
    assert.ok(code.includes("StrategyFeeder"), "Should have feeder class");
    assert.ok(code.includes("enterInitialState"), "Should have initial state method");
  });

  it("should generate event handlers for transitions", () => {
    const model = loadBdboModel();
    const generator = new TypeScriptCodeGenerator(model);
    const code = generator.generate();

    assert.ok(code.includes("onStrategyCreated"), "Should have strategy created handler");
    assert.ok(code.includes("onPriceBreakout"), "Should have price breakout handler");
    assert.ok(code.includes("onSignalFound"), "Should have signal found handler");
    assert.ok(code.includes("onOrderFilled"), "Should have order filled handler");
  });

  it("should handle conditional transitions", () => {
    const model = loadBdboModel();
    const generator = new TypeScriptCodeGenerator(model);
    const code = generator.generate();

    assert.ok(code.includes("strategy.can_retry()"), "Should include condition guard");
  });
});

describe("JSON Roundtrip", () => {
  it("should parse and re-parse consistently", () => {
    const content = readFileSync(BDBO_JSON_PATH, "utf-8");
    const def1 = parseJson(content);
    const model1 = enrich(def1);

    const json2 = JSON.stringify(def1);
    const def2 = parseJson(json2);
    const model2 = enrich(def2);

    assert.equal(model2.allStates.length, model1.allStates.length);
    assert.equal(model2.eventMap.size, model1.eventMap.size);

    const states1 = new Set(model1.allStates.map((s) => s.name));
    const states2 = new Set(model2.allStates.map((s) => s.name));
    assert.deepEqual(states1, states2);
  });
});
