/**
 * Pure edits to a system definition (Spec 82). Same contract as the other edit
 * modules: a new definition back, the input untouched, an `Error` that says
 * what to do instead when the edit cannot be made.
 *
 * Pure — no I/O.
 */
import {
  MEMBER_KINDS,
  RECONCILE_MODES,
  SYSTEM_ACTOR_KINDS,
  docKindOfPath,
  type ReconcileMode,
  type SystemActor,
  type SystemDefinition,
  type SystemMember,
  type SystemSettings,
} from "./definition.js";

const clone = (def: SystemDefinition): SystemDefinition => ({
  settings: { ...def.settings },
  members: (def.members ?? []).map((m) => ({ ...m })),
  actors: (def.actors ?? []).map((a) => ({ ...a })),
});

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")) as T;
}

export function updateSystemSettings(def: SystemDefinition, patch: Partial<SystemSettings>): SystemDefinition {
  const next = clone(def);
  next.settings = compact({ ...next.settings, ...patch }) as SystemSettings;
  return next;
}

/** `propose` waits for someone to apply a scenario's changes; `auto` applies them when the scenario is saved. */
export function setReconcileMode(def: SystemDefinition, mode: ReconcileMode): SystemDefinition {
  if (!RECONCILE_MODES.includes(mode)) throw new Error(`The reconcile mode is ${RECONCILE_MODES.join(" or ")}; got '${mode}'.`);
  return updateSystemSettings(def, { reconcile: mode });
}

export function addMember(def: SystemDefinition, member: SystemMember): SystemDefinition {
  if (!member.path?.trim()) throw new Error("A member needs a path.");
  const kind = docKindOfPath(member.path);
  if (!MEMBER_KINDS.includes(kind) || !member.path.endsWith(".json")) {
    throw new Error(`'${member.path}' is not a loom document a system can hold: use a .erdf.json, .smdf.json or .sqdf.json file.`);
  }
  const next = clone(def);
  if (next.members.some((m) => m.path === member.path)) throw new Error(`'${member.path}' is already a member.`);
  next.members.push(compact({ ...member }));
  return next;
}

/** Change what the system says about a member (its notes). `""` clears. */
export function updateMember(def: SystemDefinition, path: string, patch: { notes?: string }): SystemDefinition {
  const next = clone(def);
  const i = next.members.findIndex((m) => m.path === path);
  if (i < 0) throw new Error(`'${path}' is not a member. Members: ${def.members.map((m) => m.path).join(", ") || "none"}.`);
  next.members[i] = compact({ ...next.members[i], ...patch });
  return next;
}

export function removeMember(def: SystemDefinition, path: string): SystemDefinition {
  const next = clone(def);
  const before = next.members.length;
  next.members = next.members.filter((m) => m.path !== path);
  if (next.members.length === before) {
    throw new Error(`'${path}' is not a member. Members: ${def.members.map((m) => m.path).join(", ") || "none"}.`);
  }
  return next;
}

export function addActor(def: SystemDefinition, actor: SystemActor): SystemDefinition {
  if (!actor.name?.trim()) throw new Error("An actor needs a name.");
  if (!SYSTEM_ACTOR_KINDS.includes(actor.kind)) {
    throw new Error(`An actor is one of ${SYSTEM_ACTOR_KINDS.join(", ")}; got '${actor.kind}'.`);
  }
  const next = clone(def);
  if ((next.actors ?? []).some((a) => a.name === actor.name)) throw new Error(`Actor '${actor.name}' already exists.`);
  (next.actors ??= []).push(compact({ ...actor }));
  return next;
}

export function removeActor(def: SystemDefinition, name: string): SystemDefinition {
  const next = clone(def);
  const before = next.actors?.length ?? 0;
  next.actors = (next.actors ?? []).filter((a) => a.name !== name);
  if (next.actors.length === before) throw new Error(`Actor '${name}' not found.`);
  return next;
}

export function summarizeSystem(def: SystemDefinition): string {
  const lines = [`${def.settings?.namespace ?? ""}/${def.settings?.name ?? ""} — reconcile ${def.settings?.reconcile ?? "propose"}`];
  for (const m of def.members ?? []) lines.push(`member ${docKindOfPath(m.path)}: ${m.path}`);
  for (const a of def.actors ?? []) lines.push(`actor ${a.kind}: ${a.name}`);
  return lines.join("\n");
}
