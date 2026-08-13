/**
 * Disk read helpers for a `docId` (an SMDF project file).
 *
 * The hub NEVER writes disk — each mutating client persists through its own
 * durable channel (MCP `writeDef()`, web `PUT /api/file`, CLI `fs.writeFileSync`)
 * and stamps the resulting `mtimeMs` on the socket event. These helpers are how
 * the hub seeds a room and how the file-watch differ re-reads external edits.
 *
 * Parsing mirrors the MCP server: a file may wrap the definition in
 * `{ stateMachine: … }` (or `{ StateMachine: … }`) or store it bare.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { StateMachineDefinition } from "@miadi/stateloom-protocol";

/** Normalize a docId to an absolute path — the canonical room key. */
export function normalizeDocId(docId: string): string {
  return resolve(docId);
}

/** Read + parse a docId file into a definition, or null if absent/unparseable. */
export function readDefFile(file: string): StateMachineDefinition | null {
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const def = (parsed.stateMachine ?? parsed.StateMachine ?? parsed) as StateMachineDefinition;
    return def;
  } catch {
    return null;
  }
}

/** Current mtime in ms of a docId file, or 0 if it does not exist. */
export function mtimeOf(file: string): number {
  try {
    return existsSync(file) ? statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
}
