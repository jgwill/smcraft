/**
 * Reconcile — the scenario upgrades the machines (Spec 82).
 *
 * When an agent (or a person) tells a new story in a sequence, the machines of
 * the system may not know it yet: an event no machine defines, a transition the
 * machine does not have. Reconcile replays the scenario and, for each place the
 * walk stops that the scenario itself says how to fix, proposes the machine edit
 * as PatchOps — the vocabulary the hub already carries, so an applied proposal
 * reaches a live canvas as an ordinary patch and the person opening the machine
 * finds it already changed.
 *
 * What it can fix, in order:
 *
 * 1. A message fires an event no machine defines → add the event to the
 *    machine the message names (or the only machine), in the event source
 *    named after the sender (`<Sender>Events`), created when missing.
 * 2. The machine refuses the event, and the message says which `state` follows
 *    → add that transition on the state the machine is in, and add the state
 *    under the root first when the machine does not have it.
 *
 * Everything else — a refusal with no `state` to say where it leads, a message
 * whose `state` contradicts where the walk is, a machine that already ended,
 * a refusal from a set of possible states rather than one — is returned as
 * `unresolved`, in words, for a person or an agent to decide. Reconcile never
 * removes or rewrites what a machine already has.
 *
 * Proposals are computed on copies; nothing is written. The caller applies
 * them (the MCP writes each changed machine and patches its room).
 *
 * Pure — no I/O.
 */
import { applyPatchOps } from "../apply.js";
import type { StateMachineDefinition } from "../definition.js";
import type { PatchOp } from "../ops.js";
import { parseMessageRef, type SequenceDefinition } from "../sequence/definition.js";
import { machineNames, replayScenario, type ReplayPath, type ReplayReport, type ReplayStep } from "./replay.js";

export interface ReconcileProposal {
  /** `settings.name` of the machine. */
  machine: string;
  /** Position in the `machines` argument. */
  index: number;
  ops: PatchOp[];
  /** One sentence per change, in the order of `ops` groups. */
  reasons: string[];
}

export interface ReconcileResult {
  proposals: ReconcileProposal[];
  unresolved: string[];
  before: ReplayReport;
  after: ReplayReport;
  /** The machines with every proposal applied — what the files would hold. */
  machines: StateMachineDefinition[];
}

const identifier = (text: string): string => {
  const word = text.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^[^A-Za-z]+/, "");
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "Scenario";
};

/** Every step that stopped a path, main path first. */
function failures(report: ReplayReport): { path: ReplayPath; step: ReplayStep }[] {
  const out: { path: ReplayPath; step: ReplayStep }[] = [];
  for (const path of report.paths) {
    for (const step of path.steps) {
      if (step.result === "refused" || step.result === "unknown-event" || step.result === "ended" || step.result === "state-mismatch") {
        out.push({ path, step });
      }
    }
  }
  return out;
}

export function reconcileScenario(
  seq: SequenceDefinition,
  machines: readonly StateMachineDefinition[],
  options: { maxRounds?: number } = {},
): ReconcileResult {
  const maxRounds = options.maxRounds ?? 100;
  let current = machines.map((m) => m);
  const names = machineNames(current);
  const proposals = new Map<number, ReconcileProposal>();
  const unresolved: string[] = [];
  const settled = new Set<string>();
  const before = replayScenario(seq, current);

  // A change proposed once and still not taking effect (the walk stops at the
  // same place) must not be proposed again: that is how a loop starts.
  const proposed = new Set<string>();
  let lastKey = "";
  const propose = (index: number, ops: PatchOp[], reason: string): void => {
    proposed.add(`${index}|${JSON.stringify(ops)}`);
    current = current.map((m, i) => (i === index ? applyPatchOps(m, ops) : m));
    const p = proposals.get(index) ?? { machine: names[index], index, ops: [], reasons: [] };
    p.ops.push(...ops);
    p.reasons.push(reason);
    proposals.set(index, p);
  };

  let exhausted = true;
  for (let round = 0; round < maxRounds; round++) {
    const report = replayScenario(seq, current);
    // A path that stopped and was left open for a machine is not read further
    // for that machine: what follows is usually the consequence, not a new gap.
    const open = failures(report).find(
      ({ path, step }) =>
        !settled.has(`${step.ref}|${step.machine ?? ""}|${step.result}|${path.name}`) &&
        !settled.has(`${path.name}|${step.machine ?? ""}`),
    );
    if (!open) {
      exhausted = false;
      break;
    }
    const { path, step } = open;
    const key = `${step.ref}|${step.machine ?? ""}|${step.result}|${path.name}`;
    // The same stop, from the same states, right after a change was proposed for it.
    const stopKey = `${key}|${step.from.join("|")}`;
    const sameStopAgain = stopKey === lastKey;
    lastKey = stopKey;
    const message = parseMessageRef(seq, step.ref)?.message;
    const where = `message ${step.ref} (${path.name})`;
    const leaveOpen = (_key: string, text: string): void => {
      settled.add(key);
      settled.add(`${path.name}|${step.machine ?? ""}`);
      if (!unresolved.includes(text)) unresolved.push(text);
    };

    // Without its optional messages the scenario is a claim about the SCENARIO:
    // the rest should hold without them. A stop there is not a machine gap.
    if (path.kind === "without-optional") {
      const optional = (seq.messages ?? []).map((m, i) => (m?.optional ? String(i + 1) : "")).filter(Boolean);
      leaveOpen(
        key,
        `${where}: without its optional message${optional.length > 1 ? "s" : ""} ${optional.join(", ")} the scenario stops (${step.note ?? step.result}); if the rest depends on ${optional.length > 1 ? "them, they are" : "it, it is"} not optional`,
      );
      continue;
    }

    if (!message) {
      leaveOpen(key, `${where}: cannot be read back from the sequence`);
      continue;
    }

    if (sameStopAgain) {
      leaveOpen(key, `${where}: the change proposed for it did not let the walk through (${step.note ?? step.result}); a person has to look at ${step.machine ?? "the machine"}`);
      continue;
    }
    const proposeOnce = (index: number, ops: PatchOp[], reason: string): void => {
      if (proposed.has(`${index}|${JSON.stringify(ops)}`)) {
        leaveOpen(key, `${where}: the change it needs was already proposed and did not take effect (${step.note ?? step.result})`);
        return;
      }
      propose(index, ops, reason);
    };

    if (step.result === "unknown-event") {
      const owners = message.machine
        ? current.map((m, i) => (names[i] === message.machine || (m.settings?.name ?? "") === message.machine ? i : -1)).filter((i) => i >= 0)
        : current.length === 1 ? [0] : [];
      if (owners.length > 1) {
        leaveOpen(key, `${where}: ${owners.length} member machines are named "${message.machine}"; rename one so the message can say which`);
        continue;
      }
      const index = owners.length ? owners[0] : -1;
      if (index < 0) {
        leaveOpen(
          key,
          message.machine
            ? `${where}: fires "${message.event}" for "${message.machine}", which is not a member machine`
            : `${where}: fires "${message.event}", which no machine defines; set the message's machine to say which one should`,
        );
        continue;
      }
      const machine = current[index];
      const sourceName = `${identifier(message.from)}Events`;
      // The sender's own source when the machine has one — named `<Sender>Events`,
      // named after the sender, or fed by it — else a new `<Sender>Events`.
      const sender = identifier(message.from);
      const sourceIndex = (machine.events ?? []).findIndex(
        (s) => s?.name === sourceName || s?.name === sender || s?.name === message.from || s?.feeder === message.from,
      );
      const existing = sourceIndex >= 0 ? machine.events![sourceIndex].name : sourceName;
      const ops: PatchOp[] =
        sourceIndex >= 0
          ? [{ op: "event.add", sourceIndex, event: { id: message.event! } }]
          : [{ op: "eventSource.add", source: { name: sourceName, events: [{ id: message.event! }] } }];
      proposeOnce(index, ops, `${names[index]} defines "${message.event}" in ${existing}, because ${where} fires it`);
      continue;
    }

    if (step.result === "refused") {
      const index = names.indexOf(step.machine ?? "");
      if (!message.state) {
        leaveOpen(
          key,
          `${where}: ${step.machine} refuses "${message.event}" from ${step.from.join(" or ")}; give the message a state to say where it leads, and reconcile can add the transition`,
        );
        continue;
      }
      if (step.from.length !== 1) {
        leaveOpen(key, `${where}: ${step.machine} could be in ${step.from.join(" or ")}; choose which state "${message.event}" leaves from`);
        continue;
      }
      const machine = current[index];
      const leaf = step.from[0];
      const has = stateExists(machine, message.state);
      if (!has && !message.machine) {
        // The claim names a state this machine does not have. When another
        // machine has it, or the event reached several machines, the claim is
        // about one of them — never create one machine's state in another.
        const elsewhere = names.filter((_, i) => i !== index && stateExists(current[i], message.state!));
        const heardBy = current.filter((m) => eventsOf(m).has(message.event!)).length;
        if (elsewhere.length || heardBy > 1) {
          leaveOpen(key, `${where}: "${message.state}" ${elsewhere.length ? `is a state of another machine` : "is claimed while several machines hear the event"}; set the message's machine to say which machine it is about`);
          continue;
        }
      }
      if (!inStateTree(machine, leaf)) {
        leaveOpen(key, `${where}: ${step.machine} is in ${leaf}, inside a parallel region, which reconcile does not edit`);
        continue;
      }
      const ops: PatchOp[] = [];
      const reasons: string[] = [];
      const rootIsLeaf = leaf === machine.state?.name && !(machine.state?.states ?? []).length;
      if (!has) {
        ops.push({ op: "state.add", parent: null, state: { name: message.state, transitions: [] } });
        reasons.push(rootIsLeaf ? `gains its first state, ${message.state}` : `adds the state ${message.state}`);
      }
      if (rootIsLeaf) {
        // An empty machine: a transition on the root would be inherited by
        // every state. The new state is where the machine now starts.
        proposeOnce(index, ops, `${names[index]} ${reasons.join(" and ")}, because ${where} says the machine is there`);
        continue;
      }
      ops.push(
        leaf === message.state
          ? { op: "transition.add", state: leaf, transition: { event: message.event! } }
          : { op: "transition.add", state: leaf, transition: { event: message.event!, nextState: message.state } },
      );
      reasons.push(leaf === message.state ? `handles "${message.event}" in ${leaf} without leaving it` : `goes from ${leaf} to ${message.state} on "${message.event}"`);
      proposeOnce(index, ops, `${names[index]} ${reasons.join(" and ")}, because ${where} says so`);
      continue;
    }

    if (step.result === "state-mismatch") {
      leaveOpen(key, `${where}: ${step.note ?? "the scenario and the machine disagree"}; one of them has to change, and that is a person's call`);
      continue;
    }

    leaveOpen(key, `${where}: ${step.note ?? step.result}`);
  }

  if (exhausted) unresolved.push(`reconcile stopped after ${maxRounds} rounds; what it proposed so far is kept, and the rest needs a person`);

  return {
    proposals: [...proposals.values()].sort((a, b) => a.index - b.index),
    unresolved,
    before,
    after: replayScenario(seq, current),
    machines: current,
  };
}

/** The state is in the tree reconcile edits: nested `states`, not a parallel region. */
function inStateTree(def: StateMachineDefinition, name: string): boolean {
  const walk = (s: StateMachineDefinition["state"] | undefined): boolean => !!s && (s.name === name || (s.states ?? []).some(walk));
  return walk(def.state);
}

function eventsOf(def: StateMachineDefinition): Set<string> {
  const ids = new Set<string>();
  for (const src of def.events ?? []) for (const e of [...(src?.events ?? []), ...(src?.timers ?? [])]) if (e?.id) ids.add(e.id);
  return ids;
}

function stateExists(def: StateMachineDefinition, name: string): boolean {
  const walk = (s: StateMachineDefinition["state"] | undefined): boolean =>
    !!s && (s.name === name || (s.states ?? []).some(walk) || (s.parallel?.states ?? []).some(walk));
  return walk(def.state);
}
