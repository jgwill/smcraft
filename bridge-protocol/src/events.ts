/**
 * Wire event-name constants and envelope payload types.
 *
 * `EV` is the single source of truth for socket event names shared by hub,
 * CLI, web and agent clients. Inbound and outbound names deliberately overlap
 * for the def channel (`def:patch`, `def:full`) so a peer can echo/relay
 * without renaming.
 */
import type { StateMachineDefinition } from "./definition.js";
import type { PatchOp } from "./ops.js";

export type Role = 'agent' | 'cli' | 'web' | 'runtime';

export interface Presence {
  clientId: string;
  role: Role;
  name?: string;
  color?: string;
  joinedAt: string;
}

export interface DocSnapshot {
  docId: string;
  def: StateMachineDefinition;
  seq: number;
  mtime: number;
}

export interface PatchEnvelope {
  docId: string;
  seq: number;
  baseSeq?: number;
  ops: PatchOp[];
  origin: string;
  mtime?: number;
}

export interface FullEnvelope {
  docId: string;
  seq: number;
  def: StateMachineDefinition;
  origin: string;
  mtime?: number;
}

/**
 * What a canvas should show (Spec 82): which member of a system is open and
 * which element is focused. A view, never a document change — the hub relays it
 * to the room named by `docId` (the system file) and keeps nothing.
 */
export interface ViewEnvelope {
  /** The system document's absolute path: the room the view is for. */
  docId: string;
  /** The member to open, as the system writes its path (or absolute). Absent: the system map. */
  member?: string;
  /** `<kind>:<name>` of the element to select (`entity:WaveCount`, `message:9`). */
  focus?: string;
  /** Who asked, for the status line (`agent`). */
  origin: string;
  /** One sentence the canvas may show beside the change. */
  note?: string;
}

export const EV = {
  // inbound (client -> hub)
  JOIN: 'bridge:join',
  LEAVE: 'bridge:leave',
  PATCH_IN: 'def:patch',
  FULL_IN: 'def:full',
  REQUEST: 'def:request',
  PRESENCE_IN: 'presence:update',
  VIEW_IN: 'view:show',
  // outbound (hub -> client)
  WELCOME: 'bridge:welcome',
  PATCH_OUT: 'def:patch',
  FULL_OUT: 'def:full',
  ACK: 'def:ack',
  PRESENCE_JOIN: 'presence:join',
  PRESENCE_LEAVE: 'presence:leave',
  PRESENCE_LIST: 'presence:list',
  PRESENCE_UPDATE: 'presence:update',
  VIEW_OUT: 'view:show',
  ERROR: 'bridge:error',
} as const;

/** Deterministic pastel-ish color for a presence badge, derived from clientId. */
export function colorFor(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (Math.imul(hash, 31) + clientId.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
