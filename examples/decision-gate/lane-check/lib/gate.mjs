// gate — runs the drawing. Each answer goes through the DecisionGate machine
// (../../decision_gate.smdf.json) on smcraft's own interpreter, and the state it ends in
// is the band. The machine's guards are read from this table by their exact text; a guard
// the table does not know fails closed, so an edit to the drawing cannot widen what acts.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MACHINE_PATH = join(HERE, "..", "..", "decision_gate.smdf.json");
const ENGINE = join(HERE, "..", "..", "..", "..", "ts", "dist", "machine.js");

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const GUARDS = {
  "relation.word_owner != 'lane' and decision.ruling_id is None": (c) => c.relation.word_owner !== "lane" && c.decision.ruling_id == null,
  "decision.p >= policy.act_at": (c) => isNum(c.decision.p) && isNum(c.policy.act_at) && c.decision.p >= c.policy.act_at,
  "decision.p <= policy.block_at": (c) => isNum(c.decision.p) && isNum(c.policy.block_at) && c.decision.p <= c.policy.block_at,
  "ruling.verdict == 'act'": (c) => c.ruling?.verdict === "act",
};

export async function loadGate({ machinePath = MACHINE_PATH, enginePath = ENGINE } = {}) {
  const { Machine } = await import(enginePath);
  const { parseFile } = await import(join(dirname(enginePath), "parser.js"));
  return { Machine, definition: parseFile(machinePath) };
}

const BAND_OF_STATE = { Acting: "act", Blocked: "block", AwaitingOwner: "ask" };

// One decision through the machine: Asked → Scoring → (Acting | Blocked | AwaitingOwner).
export function runGate({ Machine, definition }, { decision, relation, policy, ruling = null }) {
  const unknownGuards = [];
  const context = { decision, relation, policy, ruling };
  const guard = (condition, _payload, ctx) => {
    const check = GUARDS[condition];
    if (!check) {
      unknownGuards.push(condition);
      return false;
    }
    return check(ctx);
  };
  const machine = new Machine(definition, { context, guard, name: "DecisionGate" });
  machine.send("EvidenceAttached");
  machine.send("Scored");
  if (ruling) machine.send("OwnerRuled");
  const ownerGate = GUARDS["relation.word_owner != 'lane' and decision.ruling_id is None"](context);
  const band = machine.state === "AwaitingOwner" && ownerGate ? "owner" : (BAND_OF_STATE[machine.state] ?? null);
  return { state: machine.state, band, visited: machine.visited, unknown_guards: unknownGuards };
}

// What a coordinator does with the lane_status choice once it may act on it.
export const COORDINATOR_MOVE = {
  finished: "collect the marks and dispatch the next lane",
  waiting: "route the held question: to the seat that owns it first, to William when it is his",
  working: "leave it; check again later",
  stopped_short: "reopen: tell the lane which asks have no evidence",
};
