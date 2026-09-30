/**
 * SYSDF — the System Definition Format (Spec 82).
 *
 * The drawings of one thing being built — its data (`.erdf.json`), its
 * behaviours (`.smdf.json`) and its scenarios (`.sqdf.json`) — are one system.
 * A system document names them and the actors its scenarios share. It is the
 * ONLY document that holds paths: members keep linking to each other by name
 * (Spec 80), and a member's path is relative to the system file, so the system
 * moves as one folder.
 *
 * What is shown on a canvas (which member is open, which element is focused)
 * is a view and is never written here, as notation is never written into an
 * ERDF: everything that reads a system reads the same file whatever is on
 * screen.
 */
import { isErdfPath, isErdDefinition } from "../erd/definition.js";
import { isSqdfPath, isSequenceDefinition } from "../sequence/definition.js";

/**
 * What happens when a scenario implies a change to the other drawings
 * (Spec 82). `propose` lists the changes and waits for someone to apply them;
 * `auto` applies them as soon as the scenario is saved — the machines, the data
 * and the actors follow the story without asking. A design choice of the
 * people working on the system, so it lives in the system document.
 */
export type ReconcileMode = "propose" | "auto";

export const RECONCILE_MODES: readonly ReconcileMode[] = ["propose", "auto"];

export interface SystemSettings {
  namespace: string;
  name: string;
  description?: string;
  /** Working notes about the whole system, for whoever opens it next. */
  notes?: string;
  /** Absent means `propose`. */
  reconcile?: ReconcileMode;
}

/** The mode in force: an override (an env var, a session choice) wins over the document; absent both, `propose`. */
export function reconcileModeOf(def: SystemDefinition | null | undefined, override?: string): ReconcileMode {
  if (override === "auto" || override === "propose") return override;
  return def?.settings?.reconcile === "auto" ? "auto" : "propose";
}

export interface SystemMember {
  /** Relative to the system file (or absolute). The member's type is its extension. */
  path: string;
  notes?: string;
}

export type SystemActorKind = "person" | "agent" | "service" | "external";

export const SYSTEM_ACTOR_KINDS: readonly SystemActorKind[] = ["person", "agent", "service", "external"];

/** Someone or something that acts in the system's scenarios, written once and shared by all of them. */
export interface SystemActor {
  name: string;
  kind: SystemActorKind;
  description?: string;
  /** The medicine-wheel node this actor is (`node:human:…`), when there is one. */
  wheelNode?: string;
}

export interface SystemDefinition {
  settings: SystemSettings;
  members: SystemMember[];
  actors?: SystemActor[];
}

export const SYSDF_EXTENSION = ".sysdf.json";

export function isSysdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(SYSDF_EXTENSION);
}

/** A system document carries `members` and none of its members' own shapes. */
export function isSystemDefinition(doc: unknown): doc is SystemDefinition {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as Record<string, unknown>;
  return Array.isArray(d.members) && !("state" in d) && !("entities" in d) && !("participants" in d);
}

export function emptySystem(namespace: string, name: string, description?: string): SystemDefinition {
  return {
    settings: description ? { namespace, name, description } : { namespace, name },
    members: [],
    actors: [],
  };
}

/** What a loom document is, by its extension. Anything else `.json` is a state machine, as it always was. */
export type DocKind = "machine" | "erd" | "sequence" | "system";

export function docKindOfPath(path: string): DocKind {
  if (isErdfPath(path)) return "erd";
  if (isSqdfPath(path)) return "sequence";
  if (isSysdfPath(path)) return "system";
  return "machine";
}

/** What a loom document is, by its content — for when only the parsed JSON is at hand. */
export function docKindOfContent(doc: unknown): DocKind | null {
  if (!doc || typeof doc !== "object") return null;
  if (isErdDefinition(doc)) return "erd";
  if (isSequenceDefinition(doc)) return "sequence";
  if (isSystemDefinition(doc)) return "system";
  if ("state" in (doc as Record<string, unknown>)) return "machine";
  return null;
}

/** The member kinds a system admits (Spec 82, D9): a system is never a member of another. */
export const MEMBER_KINDS: readonly DocKind[] = ["erd", "machine", "sequence"];

/** Resolve a member path against the system file's directory. Pure string work — no filesystem. */
export function resolveMemberPath(systemPath: string, memberPath: string): string {
  if (memberPath.startsWith("/")) return normalize(memberPath);
  const dir = systemPath.slice(0, systemPath.lastIndexOf("/") + 1) || "./";
  return normalize(dir + memberPath);
}

/** The member path a system should store for `absolute`, relative to the system's directory when it is beneath it. */
export function relativeMemberPath(systemPath: string, absolute: string): string {
  const dir = systemPath.slice(0, systemPath.lastIndexOf("/") + 1);
  const target = normalize(absolute);
  if (dir && target.startsWith(dir)) return target.slice(dir.length);
  return target;
}

function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  return (absolute ? "/" : "") + out.join("/");
}
