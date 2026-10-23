/**
 * Replay — a scenario is a walk through the machines (Spec 82, rule L008).
 *
 * A sequence and a state machine tell the same story two ways. The replay
 * reads the scenario's messages in order and, for each message that fires an
 * event, follows the transition that event takes in every member machine that
 * defines it (or only in `message.machine` when the message names one). A
 * machine that does not define the event does not hear it, as on an event bus.
 *
 * It follows the runtime's own rules (`ts/src/machine.ts`): a machine starts in
 * the first enterable leaf of its root; an event is looked up on the current
 * leaf, then on each ancestor; a transition without `nextState` stays; entering
 * a composite state enters its first non-history child, down to a leaf;
 * entering a `final` state ends the machine, and it hears nothing after.
 *
 * Guards are free text in the language of the generated code, so they cannot
 * be evaluated here. The walk therefore keeps the SET of states the machine may
 * be in: a guarded transition may or may not be taken, so its target and the
 * next candidate both stay possible; an unguarded transition always is, and
 * ends the search as it does at runtime. A message is the scenario's claim that
 * its event is handled, so when some possible states accept an event and others
 * refuse it, the refusing ones are dropped. `message.state` narrows the set the
 * same way, and is reported when the machine cannot be in that state.
 *
 * Parallel regions are not walked.
 *
 * Pure — no I/O.
 */
import type { StateDef, StateMachineDefinition, TransitionDef } from "../definition.js";
import type { SequenceDefinition, SqdMessage } from "../sequence/definition.js";
import { messageRef } from "../sequence/definition.js";

export type ReplayResult =
  /** The event moved the machine to another state. */
  | "moved"
  /** The event was handled and the machine stayed where it was. */
  | "stayed"
  /** The machine has no transition for the event from where it is. */
  | "refused"
  /** No member machine (or not the machine the message names) defines the event. */
  | "unknown-event"
  /** The machine had already reached a final state. */
  | "ended"
  /** The message says the machine is in a state it cannot be in. */
  | "state-mismatch"
  /** The message fires no event: it carries data, or it is a step no machine hears. */
  | "data";

export interface ReplayStep {
  /** `messageRef` of the message. */
  ref: string;
  label: string;
  event?: string;
  /** `settings.name` of the machine this step is about. Absent for a data step or an unknown event. */
  machine?: string;
  /** Possible states before, and after. Equal when the step changed nothing. */
  from: string[];
  to: string[];
  result: ReplayResult;
  /** Guards on the transitions taken — assumed to hold, since they cannot be evaluated here. */
  guards?: string[];
  note?: string;
}

export type ReplayPathKind = "main" | "without-optional" | "alt" | "opt" | "loop";

export interface ReplayPath {
  /** `main`, `main without optional messages`, `alt 1 · <label>` … */
  name: string;
  kind: ReplayPathKind;
  /** 0-based fragment index for alt/opt/loop paths. */
  fragment?: number;
  steps: ReplayStep[];
  /** No step was refused, unknown, ended or mismatched. */
  accepted: boolean;
  /** Where each machine stands at the end of the path. */
  end: Record<string, string[]>;
}

export interface ReplayReport {
  scenario: string;
  machines: string[];
  paths: ReplayPath[];
  accepted: boolean;
}

const FAILED: readonly ReplayResult[] = ["refused", "unknown-event", "ended", "state-mismatch"];

// ── The machine model the walk needs ────────────────────────────────────────

interface Model {
  name: string;
  def: StateMachineDefinition;
  states: Map<string, StateDef>;
  parent: Map<string, string | null>;
  events: Set<string>;
  initial: string | null;
}

export function machineName(def: StateMachineDefinition, index = 0): string {
  return def.settings?.name || def.state?.name || `machine ${index + 1}`;
}

/**
 * One name per machine, in order. Two members may carry the same
 * `settings.name` (checkSystem reports it as Y005); the walk still needs to
 * tell them apart, so a repeated name gets its position: `Order #2`.
 */
export function machineNames(machines: readonly StateMachineDefinition[]): string[] {
  const base = machines.map((m, i) => machineName(m, i));
  return base.map((n, i) => (base.indexOf(n) === i && base.lastIndexOf(n) === i ? n : `${n} #${i + 1}`));
}

function buildModel(def: StateMachineDefinition, index: number, name: string): Model {
  const states = new Map<string, StateDef>();
  const parent = new Map<string, string | null>();
  const walk = (s: StateDef, p: string | null): void => {
    if (!s?.name) return;
    if (!states.has(s.name)) {
      states.set(s.name, s);
      parent.set(s.name, p);
    }
    for (const c of s.states ?? []) walk(c, s.name);
    for (const c of s.parallel?.states ?? []) walk(c, s.name);
  };
  if (def.state) walk(def.state, null);
  const events = new Set<string>();
  for (const src of def.events ?? []) for (const e of src?.events ?? []) if (e?.id) events.add(e.id);
  for (const src of def.events ?? []) for (const t of src?.timers ?? []) if (t?.id) events.add(t.id);
  const model: Model = { name, def, states, parent, events, initial: null };
  model.initial = def.state ? initialLeaf(model, def.state.name) : null;
  return model;
}

/** The leaf a machine is in after entering `name`: first non-history child, down to a leaf. */
function initialLeaf(model: Model, name: string): string | null {
  let s = model.states.get(name);
  while (s && s.states?.length) {
    const child: StateDef | undefined = s.states.find((c) => c.kind !== "history");
    if (!child) return null;
    s = child;
  }
  return s?.name ?? null;
}

/** `name` or one of its descendants is `ancestor`. */
function isWithin(model: Model, name: string, ancestor: string): boolean {
  let cursor: string | null | undefined = name;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = model.parent.get(cursor);
  }
  return false;
}

/** The transitions an event may take from `leaf`, lowest level first, as the runtime looks them up. */
function candidates(model: Model, leaf: string, event: string): TransitionDef[] {
  const out: TransitionDef[] = [];
  let cursor: string | null | undefined = leaf;
  while (cursor) {
    for (const t of model.states.get(cursor)?.transitions ?? []) {
      if (t?.event !== event) continue;
      out.push(t);
      if (!t.condition) return out;
    }
    cursor = model.parent.get(cursor);
  }
  return out;
}

const isFinal = (model: Model, name: string): boolean => model.states.get(name)?.kind === "final";

// ── Paths ───────────────────────────────────────────────────────────────────

interface PathSpec {
  name: string;
  kind: ReplayPathKind;
  fragment?: number;
  items: { ref: string; message: SqdMessage }[];
}

function pathSpecs(seq: SequenceDefinition): PathSpec[] {
  const main = (seq.messages ?? []).map((message, i) => ({ ref: messageRef(null, i), message }));
  const specs: PathSpec[] = [{ name: "main", kind: "main", items: main }];
  if (main.some((m) => m.message?.optional)) {
    specs.push({
      name: "main without optional messages",
      kind: "without-optional",
      items: main.filter((m) => !m.message?.optional),
    });
  }
  (seq.fragments ?? []).forEach((f, fi) => {
    if (!f) return;
    const own = (f.messages ?? []).map((message, i) => ({ ref: messageRef(fi, i), message }));
    const after = Math.max(0, Math.min(f.after ?? 0, main.length));
    const head = main.slice(0, after);
    const tail = main.slice(after);
    const name = `${f.kind} ${fi + 1} · ${f.label ?? ""}`.trim();
    if (f.kind === "alt") specs.push({ name, kind: "alt", fragment: fi, items: [...head, ...own] });
    else if (f.kind === "opt") specs.push({ name, kind: "opt", fragment: fi, items: [...head, ...own, ...tail] });
    else if (f.kind === "loop") specs.push({ name, kind: "loop", fragment: fi, items: [...head, ...own, ...own, ...tail] });
  });
  return specs;
}

// ── The walk ────────────────────────────────────────────────────────────────

interface Cursor {
  states: string[];
  ended: string | null;
}

function walkPath(spec: PathSpec, models: Model[]): ReplayPath {
  const at = new Map<string, Cursor>();
  for (const m of models) {
    const ended = m.initial && isFinal(m, m.initial) ? m.initial : null;
    at.set(m.name, { states: m.initial ? [m.initial] : [], ended });
  }
  const steps: ReplayStep[] = [];
  // A message names a machine by its settings.name; two machines sharing it are ambiguous.
  const byName = new Map<string, Model | null>();
  for (const m of models) {
    const own = machineName(m.def);
    byName.set(own, byName.has(own) ? null : m);
    if (m.name !== own) byName.set(m.name, m);
  }

  for (const { ref, message } of spec.items) {
    if (!message) continue;
    const label = message.label ?? "";
    if (!message.event) {
      const step: ReplayStep = { ref, label, from: [], to: [], result: "data" };
      if (message.state) checkStateClaim(step, message, models, at);
      steps.push(step);
      continue;
    }
    const event = message.event;
    let targets = models.filter((m) => m.events.has(event));
    if (message.machine) {
      const named = byName.get(message.machine);
      if (!named) {
        const note = named === null
          ? `two member machines are named "${message.machine}"`
          : `no member machine is named "${message.machine}"`;
        steps.push({ ref, label, event, from: [], to: [], result: "unknown-event", note });
        continue;
      }
      targets = targets.filter((m) => m === named);
      if (!targets.length) {
        steps.push({ ref, label, event, machine: named.name, from: [], to: [], result: "unknown-event", note: `"${named.name}" does not define the event "${event}"` });
        continue;
      }
    }
    if (!targets.length) {
      steps.push({ ref, label, event, from: [], to: [], result: "unknown-event", note: `no member machine defines the event "${event}"` });
      continue;
    }

    for (const model of targets) {
      const cursor = at.get(model.name)!;
      const from = [...cursor.states];
      if (cursor.ended) {
        steps.push({ ref, label, event, machine: model.name, from, to: from, result: "ended", note: `${model.name} ended in ${cursor.ended} before this message` });
        continue;
      }
      // A final state hears nothing (the runtime ends there); only the others look an event up.
      const live = from.filter((s) => !isFinal(model, s));
      if (!live.length) {
        steps.push({ ref, label, event, machine: model.name, from, to: from, result: "ended", note: `${model.name} ended in ${from.join(" or ")} before this message` });
        continue;
      }
      const next = new Set<string>();
      // The guards that lead to each target, so a narrowed set reports only its own.
      const guardsTo = new Map<string, Set<string>>();
      const movesTo = new Set<string>();
      const broken: string[] = [];
      for (const s of live) {
        for (const t of candidates(model, s, event)) {
          const target = t.nextState ? initialLeaf(model, t.nextState) : s;
          if (!target) {
            broken.push(t.nextState!);
            continue;
          }
          next.add(target);
          if (target !== s) movesTo.add(target);
          if (t.condition) guardsTo.set(target, (guardsTo.get(target) ?? new Set()).add(t.condition));
        }
      }
      if (!next.size) {
        const why = broken.length
          ? `${model.name}'s transition for "${event}" from ${live.join(" or ")} leads to ${[...new Set(broken)].join(", ")}, which cannot be entered`
          : `${model.name} has no transition for "${event}" from ${live.join(" or ")}`;
        steps.push({ ref, label, event, machine: model.name, from, to: from, result: "refused", note: why });
        continue;
      }
      let to = [...next];
      const step: ReplayStep = { ref, label, event, machine: model.name, from, to, result: "moved" };
      if (message.state && (!message.machine || message.machine === model.name)) {
        const hasState = model.states.has(message.state);
        if (hasState || message.machine === model.name) {
          const within = to.filter((s) => isWithin(model, s, message.state!));
          if (within.length) to = within;
          else {
            step.result = "state-mismatch";
            step.note = hasState
              ? `the scenario says ${model.name} is in ${message.state}; the walk has it in ${to.join(" or ")}`
              : `${model.name} has no state "${message.state}"`;
          }
        }
      }
      step.to = to;
      if (step.result === "moved" && !to.some((s) => movesTo.has(s))) step.result = "stayed";
      const guards = new Set(to.flatMap((s) => [...(guardsTo.get(s) ?? [])]));
      if (guards.size) step.guards = [...guards];
      cursor.states = to;
      const finals = to.filter((s) => isFinal(model, s));
      if (finals.length && finals.length === to.length) cursor.ended = finals[0];
      steps.push(step);
    }
  }

  const end: Record<string, string[]> = {};
  for (const [name, c] of at) end[name] = c.states;
  return {
    name: spec.name,
    kind: spec.kind,
    ...(spec.fragment === undefined ? {} : { fragment: spec.fragment }),
    steps,
    accepted: !steps.some((s) => FAILED.includes(s.result)),
    end,
  };
}

/** A message that fires nothing may still say where a machine stands. */
function checkStateClaim(step: ReplayStep, message: SqdMessage, models: Model[], at: Map<string, Cursor>): void {
  const owners = models.filter((m) => (message.machine ? m.name === message.machine : m.states.has(message.state!)));
  if (!owners.length) {
    step.result = "state-mismatch";
    step.note = message.machine ? `no member machine is named "${message.machine}"` : `no member machine has a state "${message.state}"`;
    return;
  }
  for (const model of owners) {
    const cursor = at.get(model.name)!;
    const within = cursor.states.filter((s) => isWithin(model, s, message.state!));
    if (within.length) {
      cursor.states = within;
      continue;
    }
    step.machine = model.name;
    step.from = step.to = [...cursor.states];
    step.result = "state-mismatch";
    step.note = `the scenario says ${model.name} is in ${message.state}; the walk has it in ${cursor.states.join(" or ") || "no state"}`;
    return;
  }
}

export function replayScenario(seq: SequenceDefinition, machines: readonly StateMachineDefinition[]): ReplayReport {
  const names = machineNames(machines);
  const models = machines.map((m, i) => buildModel(m, i, names[i]));
  const paths = pathSpecs(seq).map((spec) => walkPath(spec, models));
  return {
    scenario: seq.settings?.name ?? "",
    machines: models.map((m) => m.name),
    paths,
    accepted: paths.every((p) => p.accepted),
  };
}

/** One line per step — what a tool prints. */
export function formatReplay(report: ReplayReport): string {
  const lines: string[] = [
    `Scenario ${report.scenario || "(unnamed)"} against ${report.machines.join(", ") || "no machine"}: ${report.accepted ? "every path is accepted" : "some paths stop"}`,
  ];
  for (const path of report.paths) {
    lines.push("", `${path.name} — ${path.accepted ? "accepted" : "stops"}`);
    for (const s of path.steps) {
      if (s.result === "data") continue;
      const move = s.from.length || s.to.length ? ` ${s.from.join("|") || "·"} → ${s.to.join("|") || "·"}` : "";
      const guard = s.guards?.length ? ` [assumed ${s.guards.join("; ")}]` : "";
      lines.push(`  ${s.ref}. ${s.event ?? ""}${s.machine ? ` @${s.machine}` : ""}:${move} ${s.result}${guard}${s.note ? ` — ${s.note}` : ""}`);
    }
  }
  return lines.join("\n");
}
