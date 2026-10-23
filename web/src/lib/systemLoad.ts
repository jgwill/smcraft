"use client";

/**
 * Loading a system (Spec 82) in the browser: the `.sysdf.json` and each member
 * it names, through the file API — which is what enforces the document
 * allowlist. A member the API refuses, or cannot parse, arrives as a
 * `LoadedMember` with `error`, and `checkSystem` reports it as Y003; it never
 * stops the rest of the system from loading.
 *
 * Also here: writing the changes `reconcileSystem` proposes, because the strip,
 * the system map and the sequence workspace all need the same write.
 */
import { useCallback, useEffect, useState } from "react";
import {
  docKindOfPath,
  hashDef,
  isSystemDefinition,
  machineName,
  membersByKind,
  reconcileSystem,
  resolveMemberPath,
  type LoadedMember,
  type PatchOp,
  type StateMachineDefinition,
  type SystemDefinition,
  type SystemReconcile,
  normalizeNotes,
} from "@miadi/stateloom-protocol";
import { createBridgeClient } from "@miadi/stateloom-client";
import { docQuery } from "./docParam";
import { loadRuntimeConfig } from "./runtimeConfig";
import { SYSTEM_CHANGED_EVENT } from "./systemParam";

export interface DocRead {
  path: string;
  content: string | null;
  exists: boolean;
  mtime?: number;
  error?: string;
}

export async function readDoc(path: string | null): Promise<DocRead> {
  try {
    const r = await fetch(`/api/file${docQuery(path)}`, { cache: "no-store" });
    const body = await r.json();
    if (!r.ok || body.error) return { path: path ?? "", content: null, exists: false, error: body.error ?? `HTTP ${r.status}` };
    return { path: body.path ?? path ?? "", content: body.content ?? null, exists: !!body.exists, mtime: body.mtime };
  } catch (e) {
    return { path: path ?? "", content: null, exists: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The file changed on disk after it was read: the write was refused, nothing was lost. */
export class DocConflict extends Error {
  constructor(path: string) {
    super(`${path.split("/").pop()} changed on disk since it was read`);
  }
}

/**
 * Write a whole document. Returns the new mtime; throws with the server's words
 * on refusal. With `readMtime` (when the writer read it), the server refuses the
 * write if the file changed since, and this throws `DocConflict`.
 */
export async function writeDoc(path: string, value: unknown, readMtime?: number): Promise<number | undefined> {
  const r = await fetch(`/api/file${docQuery(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: JSON.stringify(value, null, 2) + "\n", ...(readMtime !== undefined ? { mtime: readMtime } : {}) }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 409) throw new DocConflict(path);
  if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
  return body?.mtime;
}

export interface LoadedSystem {
  /** The system file, as the server resolved it. */
  path: string;
  def: SystemDefinition | null;
  members: LoadedMember[];
  /** Member path as the system writes it → absolute path. */
  absOf: Record<string, string>;
  /** Machine members stored wrapped as `{ stateMachine: … }`, so a write keeps the file's shape. */
  wrapped: Record<string, boolean>;
  /** When each file was read (mtime), the system file's under its own path: what a write must still find. */
  mtimes: Record<string, number>;
  error?: string;
}

export async function loadSystem(systemPath: string): Promise<LoadedSystem> {
  const read = await readDoc(systemPath);
  const empty = { path: read.path || systemPath, def: null, members: [], absOf: {}, wrapped: {}, mtimes: {} };
  if (read.error) return { ...empty, error: read.error };
  if (!read.exists || !read.content) return { ...empty, error: `${systemPath} does not exist` };
  let def: SystemDefinition | null = null;
  try {
    const parsed = normalizeNotes(JSON.parse(read.content));
    if (isSystemDefinition(parsed)) def = parsed;
  } catch {
    // Reported below.
  }
  if (!def) return { ...empty, error: `${read.path} is not a readable system definition` };

  const absOf: Record<string, string> = {};
  const wrapped: Record<string, boolean> = {};
  const mtimes: Record<string, number> = { [read.path]: read.mtime ?? 0 };
  const members = await Promise.all(
    (def.members ?? [])
      .filter((m) => m?.path)
      .map(async (m): Promise<LoadedMember> => {
        const abs = resolveMemberPath(read.path, m.path);
        absOf[m.path] = abs;
        const kind = docKindOfPath(m.path);
        const doc = await readDoc(abs);
        if (doc.error) return { path: m.path, kind, def: null, error: doc.error };
        if (!doc.exists || !doc.content) return { path: m.path, kind, def: null, error: "the file does not exist" };
        mtimes[m.path] = doc.mtime ?? 0;
        try {
          const parsed = JSON.parse(doc.content);
          if (kind === "machine" && parsed && (parsed.stateMachine || parsed.StateMachine)) {
            wrapped[m.path] = true;
            return { path: m.path, kind, def: normalizeNotes(parsed.stateMachine ?? parsed.StateMachine) };
          }
          return { path: m.path, kind, def: normalizeNotes(parsed) };
        } catch (e) {
          return { path: m.path, kind, def: null, error: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
        }
      }),
  );
  return { path: read.path, def, members, absOf, wrapped, mtimes };
}

/** Tell every holder of a loaded system that one of its files was written. */
export function notifySystemChanged(): void {
  window.dispatchEvent(new Event(SYSTEM_CHANGED_EVENT));
}

/** A system, loaded and kept current: it reloads whenever a member or the system file is written from this page. */
export function useSystem(systemPath: string | null): { system: LoadedSystem | null; reload: () => void } {
  const [loaded, setLoaded] = useState<{ for: string; system: LoadedSystem } | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener(SYSTEM_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SYSTEM_CHANGED_EVENT, reload);
  }, [reload]);
  useEffect(() => {
    if (!systemPath) return;
    let live = true;
    loadSystem(systemPath).then((system) => live && setLoaded({ for: systemPath, system }));
    return () => {
      live = false;
    };
  }, [systemPath, version]);
  // A system loaded for another path is not this one's; a reload of the same one keeps it on screen meanwhile.
  return { system: systemPath && loaded?.for === systemPath ? loaded.system : null, reload };
}

/** The absolute path of a member, or null when `doc` is not one of the system's. */
export function memberOfDoc(system: LoadedSystem | null, doc: string | null): string | null {
  if (!system || !doc) return null;
  for (const [member, abs] of Object.entries(system.absOf)) if (abs === doc) return member;
  return null;
}

/**
 * Tell a document's room what was just written, the way the MCP does
 * (mcp/src/live.ts): join, and if the room already holds the written document
 * — a cold room seeds itself from disk, and the file watch may have got there
 * first — send nothing. If the room holds exactly what the ops were computed
 * from, send the ops; if it holds anything else, send the whole document, so
 * the room ends equal to the disk either way. Without a hub this is a no-op:
 * the file is written, and the file watch carries it.
 */
async function sendToRoom(
  docId: string,
  written: unknown,
  mtime: number | undefined,
  patch?: { from: unknown; ops: PatchOp[] },
): Promise<void> {
  const { bridgeUrl } = await loadRuntimeConfig();
  if (!bridgeUrl) return;
  const client = createBridgeClient({ url: bridgeUrl, role: "web", docId, name: "web-reconcile", autoResync: false });
  try {
    const joined = await Promise.race([
      client.join(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("join timeout")), 3000)),
    ]);
    const held = joined.snapshot?.def as StateMachineDefinition | null | undefined;
    const hash = (d: unknown) => hashDef(d as StateMachineDefinition);
    if (held && hash(held) === hash(written)) return;
    await new Promise<void>((resolve) => {
      const off = client.on("ack", () => {
        off();
        resolve();
      });
      if (patch && held && hash(held) === hash(patch.from)) client.emitPatch(patch.ops, mtime);
      else client.emitFull(written as StateMachineDefinition, mtime);
      setTimeout(resolve, 800);
    });
  } catch {
    // The write already happened; a hub that did not answer only costs the live repaint.
  } finally {
    client.disconnect();
  }
}

/**
 * Write what `reconcileSystem` proposed from `system`: each changed machine,
 * ERD and the system file, disk first and only if the file is still the one
 * `system` read (else it is a conflict, and nothing of it is written); then each
 * room is told. Every holder of the system reloads after.
 */
export async function applyReconcile(
  system: LoadedSystem,
  result: SystemReconcile,
): Promise<{ written: string[]; failed: string[]; conflicts: string[] }> {
  const written: string[] = [];
  const failed: string[] = [];
  const conflicts: string[] = [];
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
      written.push(label);
    } catch (e) {
      if (e instanceof DocConflict) conflicts.push(label);
      else failed.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  for (const m of result.machines) {
    const abs = system.absOf[m.member];
    if (!abs || !m.ops.length) continue;
    await attempt(m.member, async () => {
      const body = system.wrapped[m.member] ? { stateMachine: m.def } : m.def;
      const mtime = await writeDoc(abs, body, system.mtimes[m.member]);
      const before = system.members.find((x) => x.path === m.member)?.def;
      await sendToRoom(abs, m.def, mtime, { from: before, ops: m.ops as PatchOp[] });
    });
  }
  for (const e of result.erds) {
    const abs = system.absOf[e.member];
    if (!abs) continue;
    await attempt(e.member, async () => {
      const mtime = await writeDoc(abs, e.def, system.mtimes[e.member]);
      await sendToRoom(abs, e.def, mtime);
    });
  }
  if (result.system) {
    await attempt(system.path.split("/").pop() ?? system.path, async () => {
      const mtime = await writeDoc(system.path, result.system!.def, system.mtimes[system.path]);
      await sendToRoom(system.path, result.system!.def, mtime);
    });
  }
  notifySystemChanged();
  return { written, failed, conflicts };
}

/**
 * Reconcile a system as it is on disk NOW: load it fresh, compute, write. If a
 * file changed between that load and its write (an agent's edit), reload and
 * compute once more from what is there, so the edit is built on, never lost.
 */
export async function reconcileNow(systemPath: string): Promise<{
  result: SystemReconcile | null;
  written: string[];
  failed: string[];
  conflicts: string[];
  retried: boolean;
}> {
  let last = { result: null as SystemReconcile | null, written: [] as string[], failed: [] as string[], conflicts: [] as string[] };
  for (let round = 0; round < 2; round += 1) {
    const system = await loadSystem(systemPath);
    if (!system.def) return { ...last, failed: [system.error ?? "the system could not be read"], retried: round > 0 };
    const result = reconcileSystem(system.def, system.members);
    if (!result.count) return { ...last, result, conflicts: round ? last.conflicts : [], retried: round > 0 };
    const out = await applyReconcile(system, result);
    last = { result, written: [...last.written, ...out.written], failed: out.failed, conflicts: out.conflicts };
    if (!out.conflicts.length) return { ...last, retried: round > 0 };
  }
  return { ...last, retried: true };
}

/** The names a system's members define, for suggesting what a sequence may name. */
export interface SystemVocabulary {
  events: string[];
  states: string[];
  machines: string[];
  objects: string[];
  entities: string[];
  actors: string[];
}

export function systemVocabulary(system: LoadedSystem | null): SystemVocabulary {
  const out: Record<keyof SystemVocabulary, Set<string>> = {
    events: new Set(),
    states: new Set(),
    machines: new Set(),
    objects: new Set(),
    entities: new Set(),
    actors: new Set(),
  };
  if (!system) return { events: [], states: [], machines: [], objects: [], entities: [], actors: [] };
  const { machines, erds } = membersByKind(system.members);
  machines.forEach(({ def }, i) => {
    out.machines.add(machineName(def, i));
    for (const src of def.events ?? []) {
      for (const e of [...(src?.events ?? []), ...(src?.timers ?? [])]) if (e?.id) out.events.add(e.id);
    }
    for (const o of def.settings?.objects ?? []) if (o?.instance) out.objects.add(o.instance);
    const walk = (s: StateMachineDefinition["state"] | undefined): void => {
      if (!s) return;
      out.states.add(s.name);
      (s.states ?? []).forEach(walk);
      (s.parallel?.states ?? []).forEach(walk);
    };
    walk(def.state);
  });
  for (const { def } of erds) for (const e of def.entities ?? []) if (e?.name) out.entities.add(e.name);
  for (const a of system.def?.actors ?? []) if (a?.name) out.actors.add(a.name);
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    events: sorted(out.events),
    states: sorted(out.states),
    machines: sorted(out.machines),
    objects: sorted(out.objects),
    entities: sorted(out.entities),
    actors: sorted(out.actors),
  };
}

/**
 * Join a room and stay in it: after the socket reconnects (a hub restart), the
 * hub has forgotten the room, so join again. Returns a function that stops it.
 */
export function stayJoined(client: ReturnType<typeof createBridgeClient>, onJoined?: () => void): () => void {
  let joinedOnce = false;
  let dropped = false;
  let stopped = false;
  const join = () => {
    client
      .join()
      .then(() => {
        joinedOnce = true;
        if (!stopped) onJoined?.();
      })
      .catch(() => {
        // Refused or not reachable: the next reconnect tries again.
      });
  };
  const off = client.on("status", (status) => {
    if (status !== "connected") dropped = joinedOnce;
    else if (dropped) {
      dropped = false;
      join();
    }
  });
  join();
  return () => {
    stopped = true;
    off();
  };
}
