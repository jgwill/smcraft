/**
 * Reconcile a whole system from its scenarios (Spec 82).
 *
 * `reconcileScenario` brings the machines level with one scenario. A system has
 * several scenarios, and a scenario names more than events: the entities its
 * messages carry and its participants hold belong in the ERD, the actors it
 * names belong in the system, and an object a participant IS belongs to a
 * machine. This gathers all of it into one set of changes, per document:
 *
 * - machines: PatchOps per machine (events, transitions, states, objects), so a
 *   live canvas receives them as ordinary patches;
 * - ERDs: the new definition of each ERD that gains entities;
 * - the system: its new definition when it gains actors.
 *
 * What cannot be inferred from the scenario is returned in words. Nothing is
 * removed or rewritten; every change is an addition. Pure — the caller writes.
 *
 * In `auto` mode (see `reconcileModeOf`) the caller applies the result as soon
 * as a scenario is saved; in `propose` mode it shows it and waits.
 */
import { applyPatchOps } from "../apply.js";
import type { StateMachineDefinition } from "../definition.js";
import { addEntity } from "../erd/edit.js";
import type { EntityRelationshipDefinition } from "../erd/definition.js";
import type { PatchOp } from "../ops.js";
import { allMessages } from "../sequence/definition.js";
import { membersByKind, type LoadedMember } from "./check.js";
import type { SystemActorKind, SystemDefinition } from "./definition.js";
import { addActor } from "./edit.js";
import { reconcileScenario } from "./reconcile.js";
import { machineNames } from "./replay.js";

export interface SystemReconcile {
  machines: { member: string; index: number; machine: string; ops: PatchOp[]; reasons: string[]; def: StateMachineDefinition }[];
  erds: { member: string; def: EntityRelationshipDefinition; reasons: string[] }[];
  system: { def: SystemDefinition; reasons: string[] } | null;
  unresolved: string[];
  /** Number of changes, for a one-line report. */
  count: number;
}

const actorKind = (name: string, service?: string): SystemActorKind =>
  service ? "service" : /\b(agent|bot|assistant)\b/i.test(name) ? "agent" : "person";

export function reconcileSystem(system: SystemDefinition | null, members: readonly LoadedMember[]): SystemReconcile {
  const { machines, erds, sequences } = membersByKind(members);
  const unresolved: string[] = [];
  const open = (text: string) => {
    if (!unresolved.includes(text)) unresolved.push(text);
  };

  // ── Actors ────────────────────────────────────────────────────────────────
  let sys = system;
  const sysReasons: string[] = [];
  if (sys) {
    for (const { def } of sequences) {
      for (const p of def.participants ?? []) {
        if (!p?.actor || (sys.actors ?? []).some((a) => a.name === p.actor)) continue;
        const kind = actorKind(p.actor, p.service);
        sys = addActor(sys, { name: p.actor, kind });
        sysReasons.push(`the system gains the ${kind} "${p.actor}", who takes part in ${def.settings?.name ?? "a scenario"}`);
      }
    }
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  const erdDefs = erds.map((e) => ({ member: e.member, def: e.def, reasons: [] as string[] }));
  const known = new Set(erdDefs.flatMap((e) => (e.def.entities ?? []).map((x) => x.name)));
  for (const { def: seq } of sequences) {
    const wanted: { name: string; why: string }[] = [];
    for (const p of seq.participants ?? []) {
      for (const h of p?.holds ?? []) if (h?.trim()) wanted.push({ name: h.trim(), why: `${p.name} holds it in ${seq.settings?.name ?? "a scenario"}` });
    }
    for (const { ref, message } of allMessages(seq)) {
      if (message?.carries?.trim()) wanted.push({ name: message.carries, why: `message ${ref} of ${seq.settings?.name ?? "a scenario"} carries it` });
    }
    for (const w of wanted) {
      if (known.has(w.name)) continue;
      if (!erdDefs.length) {
        open(`"${w.name}" is named as data (${w.why}), but the system has no ERD to hold it; add a .erdf.json member`);
        continue;
      }
      const target = erdDefs[0];
      target.def = addEntity(target.def, { name: w.name, notes: `Added from the scenario: ${w.why}.` });
      target.reasons.push(`${target.def.settings?.name ?? target.member} gains the entity ${w.name}, because ${w.why}`);
      known.add(w.name);
    }
  }

  // ── Machines: objects, then each scenario's events and transitions ────────
  let current = machines.map((m) => m.def);
  const names = machineNames(current);
  const ops = current.map(() => [] as PatchOp[]);
  const reasons = current.map(() => [] as string[]);
  const push = (i: number, more: PatchOp[], why: string) => {
    current = current.map((m, k) => (k === i ? applyPatchOps(m, more) : m));
    ops[i].push(...more);
    reasons[i].push(why);
  };

  for (const { def: seq } of sequences) {
    for (const p of seq.participants ?? []) {
      if (!p?.object || current.some((m) => (m.settings?.objects ?? []).some((o) => o.instance === p.object))) continue;
      const held = (p.holds ?? []).filter((h) => h?.trim());
      const single = held.length === 1 ? held[0].trim() : null;
      if (current.length === 1 && single) {
        const objects = [...(current[0].settings?.objects ?? []), { instance: p.object, class: single }];
        push(0, [{ op: "settings.update", patch: { objects } }], `${names[0]} is constructed with the object ${p.object} : ${single}, because ${p.name} is it`);
      } else {
        open(`${p.name} is the object "${p.object}", which no machine declares; ${current.length === 1 ? `say which entity it is by holding exactly one` : "declare it on the machine it belongs to"}`);
      }
    }
    const result = reconcileScenario(seq, current);
    for (const proposal of result.proposals) {
      ops[proposal.index].push(...proposal.ops);
      reasons[proposal.index].push(...proposal.reasons);
    }
    current = result.machines;
    for (const u of result.unresolved) open(`${seq.settings?.name ?? "scenario"}: ${u}`);
  }

  const machineChanges = machines
    .map((m, i) => ({ member: m.member, index: i, machine: names[i], ops: ops[i], reasons: reasons[i], def: current[i] }))
    .filter((m) => m.ops.length);
  const erdChanges = erdDefs.filter((e) => e.reasons.length);
  return {
    machines: machineChanges,
    erds: erdChanges,
    system: sys && sysReasons.length ? { def: sys, reasons: sysReasons } : null,
    unresolved,
    count:
      machineChanges.reduce((n, m) => n + m.reasons.length, 0) +
      erdChanges.reduce((n, e) => n + e.reasons.length, 0) +
      sysReasons.length,
  };
}

/** One line for a tool result or a status strip: `auto: Lifecycle +2, Data +1; 1 left open`. */
export function summarizeReconcile(r: SystemReconcile, mode: "auto" | "propose"): string {
  if (!r.count && !r.unresolved.length) return mode === "auto" ? "auto: the drawings already agree" : "the drawings agree";
  const parts = [
    ...r.machines.map((m) => `${m.machine} +${m.reasons.length}`),
    ...r.erds.map((e) => `${e.def.settings?.name ?? e.member} +${e.reasons.length}`),
    ...(r.system ? [`system +${r.system.reasons.length}`] : []),
  ];
  const changes = parts.length ? parts.join(", ") : "no change";
  const left = r.unresolved.length ? `; ${r.unresolved.length} left open` : "";
  return mode === "auto" ? `auto: ${changes}${left}` : `${r.count} change${r.count === 1 ? "" : "s"} proposed (${changes})${left}`;
}
