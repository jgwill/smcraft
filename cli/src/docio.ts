/**
 * File helpers for an SMDF project file (a `docId`).
 *
 * The CLI is the durable channel for its own mutations: it reads the on-disk
 * definition, applies an op, and writes it straight back — the bridge hub never
 * touches disk. Parsing mirrors the MCP server + bridge `docio`: a file may wrap
 * the definition in `{ stateMachine: … }` (or `{ StateMachine: … }`), or store
 * it bare.
 */
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { StateMachineDefinition } from "@smcraft/bridge-protocol";

/** Read + parse a project file into a definition, or null if absent/unparseable. */
export function readDef(path: string): StateMachineDefinition | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const def = (parsed.stateMachine ?? parsed.StateMachine ?? parsed) as StateMachineDefinition;
    return def;
  } catch {
    return null;
  }
}

/** Persist a definition, canonically wrapped in `{ stateMachine: … }`, pretty-printed. */
export function writeDef(path: string, def: StateMachineDefinition): void {
  writeFileSync(path, JSON.stringify({ stateMachine: def }, null, 2) + "\n", "utf8");
}

/** Current mtime in ms of a project file, or 0 if it does not exist. */
export function mtimeOf(path: string): number {
  try {
    return existsSync(path) ? statSync(path).mtimeMs : 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve the effective docId to an absolute path:
 *   explicit option ?? $SMCRAFT_PROJECT_FILE ?? ./statemachine.smdf.json.
 */
export function resolveDocId(opt?: string): string {
  const raw = opt ?? process.env.SMCRAFT_PROJECT_FILE ?? "./statemachine.smdf.json";
  return resolve(raw);
}
