/**
 * Framework-agnostic bridge session — the unit-testable core beneath the React
 * hook. It wraps `createBridgeClient` and maintains a single immutable
 * `SessionSnapshot` assembled from the wire channel:
 *
 *   - `def`         seeded from the join snapshot, replaced by `def:full`,
 *                   evolved by structural `def:patch` ops via `applyPatchOps`.
 *   - `activeStates` driven by presentational `runtime.enter` / `runtime.exit`
 *                   ops, which never touch `def` (applyPatchOps ignores them).
 *   - `presence` / `seq` / `status` mirror the client's bookkeeping.
 *
 * The snapshot object identity changes only when its content changes, so
 * `getSnapshot` is safe to hand directly to React's `useSyncExternalStore`.
 * Nothing here imports React — a Node `node:test` suite exercises the whole
 * behaviour without a DOM.
 */
import {
  createBridgeClient,
  type BridgeClient,
  type BridgeClientOptions,
  type BridgeStatus,
  type JoinResult,
} from "@miadi/stateloom-client";
import {
  applyPatchOps,
  type StateMachineDefinition,
  type PatchOp,
  type Presence,
  type PatchEnvelope,
  type FullEnvelope,
} from "@miadi/stateloom-protocol";

export interface SessionSnapshot {
  status: BridgeStatus;
  def: StateMachineDefinition | null;
  seq: number;
  presence: Presence[];
  activeStates: string[];
}

export interface BridgeSessionOptions extends BridgeClientOptions {
  /** Forwarded when a `def:full` frame arrives (consumers keeping their own store). */
  onFull?: (e: FullEnvelope) => void;
  /** Forwarded when a `def:patch` frame arrives. */
  onPatch?: (e: PatchEnvelope) => void;
  /** Forwarded when the presence list changes. */
  onPresence?: (list: Presence[]) => void;
}

export interface BridgeSession {
  getSnapshot(): SessionSnapshot;
  subscribe(cb: () => void): () => void;
  emitPatch(ops: PatchOp[]): void;
  emitFull(def: StateMachineDefinition): void;
  enter(state: string, from?: string, eventId?: string): void;
  exit(state: string): void;
  connect(): void;
  disconnect(): void;
}

function isRuntimeOp(op: PatchOp): op is Extract<PatchOp, { op: 'runtime.enter' | 'runtime.exit' }> {
  return op.op === 'runtime.enter' || op.op === 'runtime.exit';
}

export function createBridgeSession(opts: BridgeSessionOptions): BridgeSession {
  const { onFull, onPatch, onPresence, ...clientOpts } = opts;
  const client: BridgeClient = createBridgeClient(clientOpts);

  // --- mutable state, projected into `snapshot` on every commit ---
  let def: StateMachineDefinition | null = null;
  let seq = 0;
  let presence: Presence[] = [];
  let activeStates: string[] = [];

  let snapshot: SessionSnapshot = {
    status: client.status,
    def: null,
    seq: 0,
    presence: [],
    activeStates: [],
  };

  const subscribers = new Set<() => void>();

  function notify(): void {
    for (const cb of [...subscribers]) cb();
  }

  /** Re-project the mutable fields into a fresh snapshot, then fan out. */
  function commit(): void {
    snapshot = {
      status: client.status,
      def,
      seq,
      presence,
      activeStates,
    };
    notify();
  }

  /** Apply presentational runtime ops to `activeStates` (never touches `def`). */
  function applyRuntime(ops: PatchOp[]): void {
    for (const op of ops) {
      if (op.op === 'runtime.enter') {
        if (!activeStates.includes(op.state)) {
          activeStates = [...activeStates, op.state];
        }
      } else if (op.op === 'runtime.exit') {
        if (activeStates.includes(op.state)) {
          activeStates = activeStates.filter((s) => s !== op.state);
        }
      }
    }
  }

  // --- wire the client channels into snapshot state ---
  client.on('status', () => commit());

  client.on('full', (e: FullEnvelope) => {
    def = e.def;
    if (typeof e.seq === 'number') seq = e.seq;
    onFull?.(e);
    commit();
  });

  client.on('patch', (e: PatchEnvelope) => {
    if (typeof e.seq === 'number') seq = e.seq;
    const ops = e.ops ?? [];
    const runtimeOps = ops.filter(isRuntimeOp);
    const defOps = ops.filter((op) => !isRuntimeOp(op));
    // Structural ops rebuild `def`; runtime ops only adjust `activeStates`, so a
    // runtime-only patch leaves `def` identity untouched (no ghost mutation).
    if (defOps.length > 0 && def) {
      def = applyPatchOps(def, defOps);
    }
    applyRuntime(runtimeOps);
    onPatch?.(e);
    commit();
  });

  client.on('presence', (list: Presence[]) => {
    presence = list;
    onPresence?.(list);
    commit();
  });

  // --- lifecycle ---
  function connect(): void {
    // join() connects first, then seeds def/presence/seq from the ack snapshot.
    void client
      .join()
      .then((result: JoinResult) => {
        def = result.snapshot.def;
        seq = result.snapshot.seq;
        presence = result.presence;
        // A def-carrying snapshot must reach callback-only consumers through
        // the same channel as a live `def:full` — otherwise a tab joining an
        // already-designed room hydrates its store from nothing (cold-load
        // empty canvas). `def === null` (fresh project) is deliberately NOT
        // fanned out, preserving the consumer's own first-send seeding path.
        if (def !== null) {
          onFull?.({
            docId: result.snapshot.docId,
            def,
            seq,
            mtime: result.snapshot.mtime,
            origin: 'join',
          });
        }
        commit();
      })
      .catch(() => {
        // Failure surfaces through the 'status'/'error' channel; reflect it.
        commit();
      });
  }

  function disconnect(): void {
    // client.disconnect() flips status to 'disconnected' and fires 'status',
    // which commits a fresh snapshot for us.
    client.disconnect();
  }

  function emitPatch(ops: PatchOp[]): void {
    client.emitPatch(ops);
  }

  function emitFull(next: StateMachineDefinition): void {
    client.emitFull(next);
  }

  function enter(state: string, from?: string, eventId?: string): void {
    const op: PatchOp = {
      op: 'runtime.enter',
      state,
      ...(from !== undefined ? { from } : {}),
      ...(eventId !== undefined ? { eventId } : {}),
    };
    client.emitPatch([op]);
  }

  function exit(state: string): void {
    client.emitPatch([{ op: 'runtime.exit', state }]);
  }

  function subscribe(cb: () => void): () => void {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }

  function getSnapshot(): SessionSnapshot {
    return snapshot;
  }

  return {
    getSnapshot,
    subscribe,
    emitPatch,
    emitFull,
    enter,
    exit,
    connect,
    disconnect,
  };
}
