/**
 * Monotonic sequence + cheap content hash helpers.
 *
 * `hashDef` is an FNV-1a hash over `JSON.stringify(def)` — used later by the
 * hub's dedup ring to cheaply recognise a definition it has already seen.
 * `nextSeq` exists for symmetry with the hub's sequence bookkeeping.
 */
import type { StateMachineDefinition } from "./definition.js";

/** FNV-1a (32-bit) over the JSON serialization of the definition. */
export function hashDef(def: StateMachineDefinition): string {
  const s = JSON.stringify(def);
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Returns the next sequence number. */
export function nextSeq(current: number): number {
  return current + 1;
}
