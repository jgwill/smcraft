/**
 * Framework-agnostic socket.io-client wrapper for the smcraft real-time design
 * bridge. One thin object handles connect/join, the def channel (patch/full)
 * with sequence-gap auto-resync, presence bookkeeping, and status transitions —
 * consumed identically by the CLI, the MCP server, and the React hook.
 *
 * The wire vocabulary lives in `@miadi/stateloom-protocol` (`EV`, envelopes);
 * this package owns only the client-side state machine around it.
 */
import { io, type Socket } from "socket.io-client";
import {
  type StateMachineDefinition,
  type PatchOp,
  type Role,
  type Presence,
  type DocSnapshot,
  type PatchEnvelope,
  type FullEnvelope,
  EV,
} from "@miadi/stateloom-protocol";

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface BridgeClientOptions {
  url: string;
  role: Role;
  docId: string;
  name?: string;
  token?: string;
  /** Auto-request a resync when an incoming seq skips ahead. Default true. */
  autoResync?: boolean;
}

export interface JoinResult {
  selfId: string;
  snapshot: DocSnapshot;
  presence: Presence[];
}

/** Payload forwarded verbatim from a hub `def:ack` frame. */
export interface AckPayload {
  seq: number;
  baseSeq?: number;
  [k: string]: unknown;
}

export type BridgeEvent = 'patch' | 'full' | 'ack' | 'presence' | 'error' | 'status';

export interface BridgeClient {
  connect(): Promise<void>;
  join(): Promise<JoinResult>;
  emitPatch(ops: PatchOp[], mtime?: number, baseSeq?: number): void;
  emitFull(def: StateMachineDefinition, mtime?: number): void;
  request(sinceSeq?: number): void;
  updatePresence(p: { cursor?: unknown; selection?: unknown }): void;
  on(event: 'patch', h: (e: PatchEnvelope) => void): () => void;
  on(event: 'full', h: (e: FullEnvelope) => void): () => void;
  on(event: 'ack', h: (e: AckPayload) => void): () => void;
  on(event: 'presence', h: (list: Presence[]) => void): () => void;
  on(event: 'error', h: (e: { code: string; message: string }) => void): () => void;
  on(event: 'status', h: (s: BridgeStatus) => void): () => void;
  get status(): BridgeStatus;
  get lastSeq(): number;
  get presence(): Presence[];
  disconnect(): void;
}

/** Shape of the hub's `bridge:join` ack callback payload. */
interface JoinAck {
  selfId: string;
  snapshot: DocSnapshot;
  presence?: Presence[];
  error?: { code: string; message: string };
}

function clientIdOf(p: unknown): string | undefined {
  if (p && typeof p === 'object' && 'clientId' in p) {
    const v = (p as { clientId?: unknown }).clientId;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

export function createBridgeClient(opts: BridgeClientOptions): BridgeClient {
  const { url, role, docId, name, token } = opts;
  const autoResync = opts.autoResync !== false; // default true

  const socket: Socket = io(url, {
    auth: { token },
    autoConnect: false,
  });

  let status: BridgeStatus = 'disconnected';
  let lastSeq = 0;
  let selfId = '';
  let presence: Presence[] = [];

  const listeners: Record<BridgeEvent, Set<(...args: unknown[]) => void>> = {
    patch: new Set(),
    full: new Set(),
    ack: new Set(),
    presence: new Set(),
    error: new Set(),
    status: new Set(),
  };

  function fire(event: BridgeEvent, arg?: unknown): void {
    for (const h of [...listeners[event]]) h(arg);
  }

  function setStatus(next: BridgeStatus): void {
    if (status === next) return;
    status = next;
    fire('status', next);
  }

  function request(sinceSeq?: number): void {
    socket.emit(EV.REQUEST, { docId, sinceSeq });
  }

  /** Gap-detect against the current lastSeq, resync if needed, then advance. */
  function handleSeq(seq: unknown): void {
    if (typeof seq !== 'number') return;
    if (autoResync && seq > lastSeq + 1) {
      request(lastSeq);
    }
    lastSeq = Math.max(lastSeq, seq);
  }

  function firePresence(): void {
    fire('presence', [...presence]);
  }

  // --- lifecycle / status wiring (persistent) ---
  socket.on('connect', () => setStatus('connected'));
  socket.on('disconnect', () => setStatus('disconnected'));
  socket.on('connect_error', (err: Error) => {
    setStatus('error');
    fire('error', { code: 'connect_error', message: err?.message ?? String(err) });
  });

  // --- def channel (server -> client) ---
  // The hub broadcasts to the whole room INCLUDING the origin so the sender
  // learns its hub-assigned seq. A bidirectional client (the web UI) has
  // already applied its own edit locally/optimistically, so it must advance
  // lastSeq from its own echo but NOT re-apply it — otherwise `state.add`
  // duplicates and `state.remove` throws-then-flags-error on every self edit.
  socket.on(EV.PATCH_OUT, (env: PatchEnvelope) => {
    handleSeq(env?.seq);
    if (env?.origin && env.origin === selfId) return;
    fire('patch', env);
  });
  socket.on(EV.FULL_OUT, (env: FullEnvelope) => {
    handleSeq(env?.seq);
    if (env?.origin && env.origin === selfId) return;
    fire('full', env);
  });
  socket.on(EV.ACK, (env: AckPayload) => {
    fire('ack', env);
  });

  // --- hub-originated error frames ---
  socket.on(EV.ERROR, (e: { code?: string; message?: string }) => {
    fire('error', { code: e?.code ?? 'error', message: e?.message ?? '' });
  });

  // --- presence bookkeeping ---
  socket.on(EV.PRESENCE_LIST, (list: Presence[]) => {
    presence = Array.isArray(list) ? [...list] : [];
    firePresence();
  });
  socket.on(EV.PRESENCE_JOIN, (p: Presence) => {
    const id = clientIdOf(p);
    if (!id) return;
    presence = [...presence.filter((x) => x.clientId !== id), p];
    firePresence();
  });
  socket.on(EV.PRESENCE_LEAVE, (p: Presence | { clientId: string }) => {
    const id = clientIdOf(p);
    if (!id) return;
    presence = presence.filter((x) => x.clientId !== id);
    firePresence();
  });
  socket.on(EV.PRESENCE_UPDATE, (p: Partial<Presence> & { clientId?: string }) => {
    const id = clientIdOf(p);
    if (!id) return;
    const idx = presence.findIndex((x) => x.clientId === id);
    if (idx === -1) {
      presence = [...presence, p as Presence];
    } else {
      const merged = { ...presence[idx], ...p } as Presence;
      presence = presence.map((x, i) => (i === idx ? merged : x));
    }
    firePresence();
  });

  function connect(): Promise<void> {
    if (socket.connected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      setStatus('connecting');
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      socket.connect();
    });
  }

  async function join(): Promise<JoinResult> {
    await connect();
    return new Promise<JoinResult>((resolve, reject) => {
      socket.emit(EV.JOIN, { docId, role, name }, (ack: JoinAck) => {
        if (!ack || ack.error) {
          const e = ack?.error ?? { code: 'join_failed', message: 'no join ack' };
          fire('error', e);
          reject(new Error(`${e.code}: ${e.message}`));
          return;
        }
        selfId = ack.selfId;
        presence = ack.presence ? [...ack.presence] : [];
        lastSeq = ack.snapshot?.seq ?? 0;
        firePresence();
        resolve({ selfId, snapshot: ack.snapshot, presence: [...presence] });
      });
    });
  }

  function emitPatch(ops: PatchOp[], mtime?: number, baseSeq?: number): void {
    socket.emit(EV.PATCH_IN, { docId, ops, origin: selfId, baseSeq, mtime });
  }

  function emitFull(def: StateMachineDefinition, mtime?: number): void {
    socket.emit(EV.FULL_IN, { docId, def, origin: selfId, mtime });
  }

  function updatePresence(p: { cursor?: unknown; selection?: unknown }): void {
    socket.emit(EV.PRESENCE_IN, {
      docId,
      clientId: selfId,
      cursor: p.cursor,
      selection: p.selection,
    });
  }

  function on(event: BridgeEvent, handler: (arg: never) => void): () => void {
    const set = listeners[event];
    const h = handler as unknown as (...args: unknown[]) => void;
    set.add(h);
    return () => set.delete(h);
  }

  function disconnect(): void {
    if (socket.connected && selfId) {
      socket.emit(EV.LEAVE, { docId, clientId: selfId });
    }
    socket.disconnect();
    setStatus('disconnected');
  }

  return {
    connect,
    join,
    emitPatch,
    emitFull,
    request,
    updatePresence,
    on: on as BridgeClient['on'],
    disconnect,
    get status() {
      return status;
    },
    get lastSeq() {
      return lastSeq;
    },
    get presence() {
      return [...presence];
    },
  };
}
