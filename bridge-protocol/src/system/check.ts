/**
 * `checkSystem` — every name that crosses between the members of one system
 * (Spec 82), and `systemLinks`, the same crossings as data a canvas can follow.
 *
 * Rules, by prefix:
 *
 * - Y001–Y005: the system document itself (settings, members, actors), and
 *   machines sharing a name.
 * - E, S: each ERD's and each sequence's own rules (`validateErd`,
 *   `validateSequence`). A machine's V rules live with the engine, so the
 *   caller adds them (the MCP does).
 * - L001–L004: the ERD ↔ machine links of Spec 80, run for every machine
 *   against the entities of every ERD in the system.
 * - L005: a message's event is an event of a member machine.
 * - L006: a participant's actor, object and held entities exist.
 * - L007: a message's carried entity exists.
 * - L009 (warning): a state that is not final and has no way out.
 * - L008: the replay — each path of each scenario is a walk the machines
 *   accept. Reported as warnings: a scenario ahead of its machines is how new
 *   behaviour is designed, and `reconcileScenario` proposes the catch-up.
 *
 * The caller loads the members (paths resolved against the system file);
 * this module only reads what it is given.
 *
 * Pure — no I/O.
 */
import type { StateMachineDefinition } from "../definition.js";
import { stateOfList, type EntityRelationshipDefinition } from "../erd/definition.js";
import { checkLinks, checkStateOf, guardFields } from "../erd/links.js";
import { validateErd } from "../erd/validate.js";
import { allMessages, type SequenceDefinition } from "../sequence/definition.js";
import { validateSequence } from "../sequence/validate.js";
import {
  MEMBER_KINDS,
  SYSTEM_ACTOR_KINDS,
  docKindOfContent,
  docKindOfPath,
  type DocKind,
  type SystemDefinition,
} from "./definition.js";
import { machineName, machineNames as uniqueMachineNames, replayScenario, type ReplayReport } from "./replay.js";

export interface LoadedMember {
  /** The path as the system document writes it. */
  path: string;
  kind: DocKind;
  /** The parsed document, or null when it could not be read. */
  def: unknown;
  /** Why it could not be read. */
  error?: string;
}

export interface SystemIssue {
  ruleId: string;
  message: string;
  severity: "error" | "warning";
  /** The member the issue is in, as the system writes its path. */
  member?: string;
  element?: string;
}

export interface SystemCheck {
  issues: SystemIssue[];
  /** One replay per sequence member, in member order. */
  replays: { member: string; report: ReplayReport }[];
}

export interface SystemMembers {
  machines: { member: string; def: StateMachineDefinition }[];
  erds: { member: string; def: EntityRelationshipDefinition }[];
  sequences: { member: string; def: SequenceDefinition }[];
}

/** Sort loaded members by kind, keeping only the ones whose content matches their extension. */
export function membersByKind(members: readonly LoadedMember[]): SystemMembers {
  const out: SystemMembers = { machines: [], erds: [], sequences: [] };
  for (const m of members) {
    if (!m.def || m.error || docKindOfContent(m.def) !== m.kind) continue;
    if (m.kind === "machine") out.machines.push({ member: m.path, def: m.def as StateMachineDefinition });
    if (m.kind === "erd") out.erds.push({ member: m.path, def: m.def as EntityRelationshipDefinition });
    if (m.kind === "sequence") out.sequences.push({ member: m.path, def: m.def as SequenceDefinition });
  }
  return out;
}

/** The entities of every ERD at hand, as one ERD for the link rules (first definition of a name wins). */
function mergedErd(erds: SystemMembers["erds"]): EntityRelationshipDefinition | null {
  if (!erds.length) return null;
  const seen = new Set<string>();
  const entities = erds.flatMap(({ def }) => def.entities ?? []).filter((e) => e?.name && !seen.has(e.name) && seen.add(e.name));
  return {
    settings: { namespace: erds[0].def.settings?.namespace ?? "", name: erds.map((e) => e.def.settings?.name).join(" + ") },
    entities,
    relationships: erds.flatMap(({ def }) => def.relationships ?? []),
  };
}

export function checkSystem(system: SystemDefinition | null, members: readonly LoadedMember[]): SystemCheck {
  const issues: SystemIssue[] = [];
  const err = (ruleId: string, message: string, member?: string, element?: string): void => {
    issues.push({ ruleId, message, severity: "error", ...(member ? { member } : {}), ...(element ? { element } : {}) });
  };
  const warn = (ruleId: string, message: string, member?: string, element?: string): void => {
    issues.push({ ruleId, message, severity: "warning", ...(member ? { member } : {}), ...(element ? { element } : {}) });
  };

  // ── Y: the system document ────────────────────────────────────────────────
  if (system) {
    if (!system.settings?.name) err("Y001", "The system has no settings.name");
    if (!system.settings?.namespace) err("Y001", "The system has no settings.namespace");
    const paths = new Set<string>();
    for (const [i, m] of (system.members ?? []).entries()) {
      if (!m?.path) {
        err("Y002", `Member at index ${i} has no path`, undefined, `members[${i}]`);
        continue;
      }
      if (paths.has(m.path)) err("Y002", `"${m.path}" is listed twice`, m.path);
      paths.add(m.path);
      if (!MEMBER_KINDS.includes(docKindOfPath(m.path)) || !m.path.endsWith(".json")) {
        err("Y002", `"${m.path}" is not a document a system holds (.erdf.json, .smdf.json, .sqdf.json)`, m.path);
      }
    }
    const actors = new Set<string>();
    for (const [i, a] of (system.actors ?? []).entries()) {
      if (!a?.name) {
        err("Y004", `Actor at index ${i} has no name`, undefined, `actors[${i}]`);
        continue;
      }
      if (actors.has(a.name)) err("Y004", `Duplicate actor "${a.name}"`, undefined, a.name);
      actors.add(a.name);
      if (!SYSTEM_ACTOR_KINDS.includes(a.kind)) {
        err("Y004", `Actor "${a.name}" has kind "${a.kind ?? ""}"; expected one of ${SYSTEM_ACTOR_KINDS.join(", ")}`, undefined, a.name);
      }
    }
  }
  for (const m of members) {
    if (m.error || !m.def) {
      err("Y003", `"${m.path}" cannot be read: ${m.error ?? "no content"}`, m.path);
    } else if (docKindOfContent(m.def) !== m.kind) {
      err("Y003", `"${m.path}" is named as a ${m.kind} but holds ${docKindOfContent(m.def) ?? "something else"}`, m.path);
    }
  }

  const { machines, erds, sequences } = membersByKind(members);

  // Y005: a message names a machine by settings.name, so two machines sharing one are ambiguous.
  const seenMachine = new Map<string, string>();
  for (const { member, def } of machines) {
    const name = machineName(def);
    const first = seenMachine.get(name);
    if (first) err("Y005", `"${member}" and "${first}" are both machines named "${name}"; a message cannot say which`, member);
    else seenMachine.set(name, member);
  }

  // ── Each member's own rules ───────────────────────────────────────────────
  for (const { member, def } of erds) for (const e of validateErd(def)) err(e.ruleId, e.message, member, e.element);
  for (const { member, def } of sequences) for (const e of validateSequence(def)) err(e.ruleId, e.message, member, e.element);

  // ── L001–L004: machines against the data ──────────────────────────────────
  const erd = mergedErd(erds);
  if (erd) {
    for (const { member, def } of machines) for (const e of checkLinks(def, erd)) err(e.ruleId, e.message, member, e.element);
    const names = machines.map(({ def }, i) => machineName(def, i));
    for (const { member, def } of erds) for (const e of checkStateOf(def, names)) err(e.ruleId, e.message, member, e.element);
  }

  // ── L009: a state with no way out ─────────────────────────────────────────
  // A leaf that is not final, with no transition on it or on any state around
  // it, holds the machine for ever. It is usually a state a scenario added and
  // nobody has yet said how it ends — the next instance's question.
  for (const { member, def } of machines) {
    const walk = (s: StateMachineDefinition["state"] | undefined, inherited: boolean): void => {
      if (!s) return;
      const exits = inherited || (s.transitions ?? []).length > 0;
      const children = s.states ?? [];
      if (!children.length && !s.parallel && s !== def.state && s.kind !== "final" && s.kind !== "history" && !exits) {
        warn("L009", `${machineName(def)}: ${s.name} has no way out and is not final; say how the machine leaves it, or mark it final`, member, `state:${s.name}`);
      }
      for (const c of children) walk(c, exits);
    };
    walk(def.state, false);
  }

  // ── L005–L008: scenarios against the machines and the data ────────────────
  const machineDefs = machines.map((m) => m.def);
  const machineNames = new Set(machineDefs.map((d, i) => machineName(d, i)));
  const events = new Map<string, Set<string>>();
  const states = new Set<string>();
  const objects = new Set<string>();
  machineDefs.forEach((d, i) => {
    const ids = new Set<string>();
    for (const src of d.events ?? []) {
      for (const e of src?.events ?? []) if (e?.id) ids.add(e.id);
      for (const t of src?.timers ?? []) if (t?.id) ids.add(t.id);
    }
    events.set(machineName(d, i), ids);
    const walk = (s: StateMachineDefinition["state"] | undefined): void => {
      if (!s) return;
      states.add(s.name);
      (s.states ?? []).forEach(walk);
      (s.parallel?.states ?? []).forEach(walk);
    };
    walk(d.state);
    for (const o of d.settings?.objects ?? []) if (o?.instance) objects.add(o.instance);
  });
  const entityNames = new Set((erd?.entities ?? []).map((e) => e.name));
  const actorNames = new Set((system?.actors ?? []).map((a) => a.name));
  const replays: SystemCheck["replays"] = [];

  for (const { member, def } of sequences) {
    let saidNoErd = false;
    const needErd = (what: string): boolean => {
      if (erd) return true;
      if (!saidNoErd) warn("L006", `${what} name entities, but the system has no ERD to hold them`, member);
      saidNoErd = true;
      return false;
    };
    for (const p of def.participants ?? []) {
      if (!p?.name) continue;
      const element = `participant:${p.name}`;
      if (p.actor && system && !actorNames.has(p.actor)) {
        err("L006", `Participant "${p.name}" is the actor "${p.actor}", which the system does not list`, member, element);
      }
      if (p.object && !objects.has(p.object)) {
        err("L006", `Participant "${p.name}" is the object "${p.object}", which no member machine declares`, member, element);
      }
      if (p.holds?.length && needErd("Participants' holds")) {
        for (const h of p.holds) {
          if (!entityNames.has(h)) err("L006", `Participant "${p.name}" holds "${h}", which is not an entity`, member, element);
        }
      }
    }
    for (const { ref, message } of allMessages(def)) {
      if (!message) continue;
      const element = `message:${ref}`;
      if (message.machine && !machineNames.has(message.machine)) {
        err("L005", `Message ${ref} names the machine "${message.machine}", which is not a member`, member, element);
      } else if (message.event) {
        const defined = message.machine
          ? events.get(message.machine)?.has(message.event)
          : [...events.values()].some((ids) => ids.has(message.event!));
        if (!defined) {
          err(
            "L005",
            `Message ${ref} fires "${message.event}", which ${message.machine ? `"${message.machine}" does not define` : "no member machine defines"}`,
            member,
            element,
          );
        }
      }
      if (message.carries && needErd("Messages' carries") && !entityNames.has(message.carries)) {
        err("L007", `Message ${ref} carries "${message.carries}", which is not an entity`, member, element);
      }
      if (message.state && !states.has(message.state)) {
        warn("L008", `Message ${ref} says the machine is then in "${message.state}", which no member machine has`, member, element);
      }
    }
    const report = replayScenario(def, machineDefs);
    replays.push({ member, report });
    // The first stop of each machine on each path is the finding; the stops
    // after it on that path are usually its consequence, so they are counted.
    for (const path of report.paths) {
      const stops = path.steps.filter((s) => s.result === "refused" || s.result === "ended" || s.result === "state-mismatch");
      const machinesStopped = [...new Set(stops.map((s) => s.machine ?? ""))];
      for (const machine of machinesStopped) {
        const mine = stops.filter((s) => (s.machine ?? "") === machine);
        const first = mine[0];
        const more = mine.length > 1 ? ` (${mine.length - 1} later message${mine.length > 2 ? "s stop" : " stops"} too)` : "";
        const why = path.kind === "without-optional" ? " — a message the rest depends on may not be optional" : "";
        warn("L008", `${path.name}, message ${first.ref}: ${first.note ?? first.result}${more}${why}`, member, `message:${first.ref}`);
      }
    }
  }

  return { issues, replays };
}

// ── The crossings as data ───────────────────────────────────────────────────

export type ElementKind = "entity" | "attribute" | "machine" | "object" | "event" | "state" | "participant" | "message";

/** One element of one member: `focus` on a canvas is `<kind>:<name>`. */
export interface ElementRef {
  member: string;
  kind: ElementKind;
  name: string;
}

export interface SystemLink {
  from: ElementRef;
  to: ElementRef;
  rule: string;
  /** Read from `from` (`guard reads WaveCount.wave_label`). */
  text: string;
  /** Read from `to` (`is read by the guard on Published_Evaluating`). */
  back: string;
}

export function elementFocus(ref: Pick<ElementRef, "kind" | "name">): string {
  return `${ref.kind}:${ref.name}`;
}

export function parseFocus(focus: string): { kind: ElementKind; name: string } | null {
  const i = focus.indexOf(":");
  if (i <= 0) return null;
  const kind = focus.slice(0, i) as ElementKind;
  const known: ElementKind[] = ["entity", "attribute", "machine", "object", "event", "state", "participant", "message"];
  return known.includes(kind) ? { kind, name: focus.slice(i + 1) } : null;
}

/**
 * Every name that crosses between members, as links a canvas can follow — the
 * same crossings `checkSystem` checks, kept only where both ends exist. The
 * replay's main path adds `message → state` for each message that moves a
 * machine.
 */
export function systemLinks(members: readonly LoadedMember[]): SystemLink[] {
  const { machines, erds, sequences } = membersByKind(members);
  const links: SystemLink[] = [];
  const entityHome = new Map<string, string>();
  for (const { member, def } of erds) for (const e of def.entities ?? []) if (e?.name && !entityHome.has(e.name)) entityHome.set(e.name, member);
  const attributes = new Map<string, Set<string>>();
  for (const { def } of erds) for (const e of def.entities ?? []) attributes.set(e.name, new Set((e.attributes ?? []).map((a) => a.name)));

  const eventHome = new Map<string, { member: string; machine: string }[]>();
  const objectHome = new Map<string, { member: string; className: string }>();
  machines.forEach(({ member, def }, i) => {
    const name = machineName(def, i);
    for (const src of def.events ?? []) {
      for (const e of [...(src?.events ?? []), ...(src?.timers ?? [])]) {
        if (!e?.id) continue;
        const list = eventHome.get(e.id) ?? [];
        list.push({ member, machine: name });
        eventHome.set(e.id, list);
      }
    }
    for (const o of def.settings?.objects ?? []) {
      if (!o?.instance) continue;
      if (!objectHome.has(o.instance)) objectHome.set(o.instance, { member, className: o.class });
      const home = entityHome.get(o.class);
      if (home) {
        links.push({
          from: { member, kind: "object", name: o.instance },
          to: { member: home, kind: "entity", name: o.class },
          rule: "L001",
          text: `is constructed as the entity ${o.class}`,
          back: `is the class of ${name}'s object ${o.instance}`,
        });
      }
    }
    const walk = (s: StateMachineDefinition["state"] | undefined): void => {
      if (!s) return;
      for (const t of s.transitions ?? []) {
        if (!t?.condition) continue;
        for (const o of def.settings?.objects ?? []) {
          const home = entityHome.get(o.class);
          if (!home) continue;
          for (const field of guardFields(t.condition, o.instance)) {
            if (!attributes.get(o.class)?.has(field)) continue;
            links.push({
              from: { member, kind: "event", name: t.event },
              to: { member: home, kind: "attribute", name: `${o.class}.${field}` },
              rule: "L002",
              text: `its guard on ${s.name} reads ${o.class}.${field}`,
              back: `is read by the ${t.event} guard on ${s.name}`,
            });
          }
        }
      }
      (s.states ?? []).forEach(walk);
    };
    walk(def.state);
  });

  const replayNames = uniqueMachineNames(machines.map((m) => m.def));
  const machineMember = new Map(machines.map(({ member }, i) => [replayNames[i], member]));
  for (const { member, def } of erds) {
    for (const e of def.entities ?? []) {
      for (const a of e.attributes ?? []) {
        for (const machine of stateOfList(a)) {
          const home = machineMember.get(machine) ?? machines.find(({ def }) => machineName(def) === machine)?.member;
          if (!home) continue;
          links.push({
            from: { member, kind: "attribute", name: `${e.name}.${a.name}` },
            to: { member: home, kind: "machine", name: machine },
            rule: "L003",
            text: `stores the state of ${machine}`,
            back: `keeps its state in ${e.name}.${a.name}`,
          });
        }
      }
    }
  }

  for (const { member, def } of sequences) {
    for (const p of def.participants ?? []) {
      if (!p?.name) continue;
      const from: ElementRef = { member, kind: "participant", name: p.name };
      const obj = p.object ? objectHome.get(p.object) : undefined;
      if (obj) links.push({ from, to: { member: obj.member, kind: "object", name: p.object! }, rule: "L006", text: `is the object ${p.object}`, back: `is the participant ${p.name}` });
      for (const h of p.holds ?? []) {
        const home = entityHome.get(h);
        if (home) links.push({ from, to: { member: home, kind: "entity", name: h }, rule: "L006", text: `holds ${h}`, back: `is held by ${p.name}` });
      }
    }
    for (const { ref, message } of allMessages(def)) {
      if (!message) continue;
      const from: ElementRef = { member, kind: "message", name: ref };
      if (message.event) {
        for (const home of eventHome.get(message.event) ?? []) {
          if (message.machine && message.machine !== home.machine) continue;
          links.push({ from, to: { member: home.member, kind: "event", name: message.event }, rule: "L005", text: `fires ${message.event}`, back: `is fired by message ${ref} of ${def.settings?.name ?? "the scenario"}` });
        }
      }
      if (message.carries) {
        const home = entityHome.get(message.carries);
        if (home) links.push({ from, to: { member: home, kind: "entity", name: message.carries }, rule: "L007", text: `carries ${message.carries}`, back: `is carried by message ${ref}` });
      }
    }
    const report = replayScenario(def, machines.map((m) => m.def));
    const main = report.paths.find((p) => p.kind === "main");
    for (const step of main?.steps ?? []) {
      if (step.result !== "moved" || !step.machine) continue;
      const home = machineMember.get(step.machine);
      if (!home) continue;
      for (const state of step.to) {
        links.push({
          from: { member, kind: "message", name: step.ref },
          to: { member: home, kind: "state", name: state },
          rule: "L008",
          text: `moves ${step.machine} to ${state}`,
          back: `is entered on message ${step.ref}`,
        });
      }
    }
  }
  return links;
}

/** The links touching one element, each read from that element's side. */
export function linksOf(links: readonly SystemLink[], member: string, focus: string): { other: ElementRef; text: string; rule: string }[] {
  const f = parseFocus(focus);
  if (!f) return [];
  const same = (r: ElementRef) => r.member === member && r.kind === f.kind && r.name === f.name;
  const out: { other: ElementRef; text: string; rule: string }[] = [];
  for (const l of links) {
    if (same(l.from)) out.push({ other: l.to, text: l.text, rule: l.rule });
    else if (same(l.to)) out.push({ other: l.from, text: l.back, rule: l.rule });
  }
  return out;
}
