/**
 * One-shot pushes to rooms other than the active document's (Spec 82).
 *
 * The server's own bridge client is joined to the active document's room, and
 * the hub makes a socket that re-joins leave its old room. So when a scenario
 * upgrades a machine, or an agent asks the system's canvas to show something,
 * the push goes through a short-lived client of its own: join that room, send,
 * wait for the hub's answer, disconnect.
 *
 * Every push is best-effort and comes AFTER the file is written: an unreachable
 * hub leaves the file standing, and the outcome says so in words.
 *
 * Joining a room the hub has not opened yet seeds it from disk, which already
 * holds the change; applying the ops on top would add them twice. So a push is
 * skipped when the room's snapshot already equals what was written.
 */
import { createBridgeClient, type BridgeClient } from "@miadi/stateloom-client";
import {
  hashDef,
  type PatchOp,
  type StateMachineDefinition,
  type ViewEnvelope,
} from "@miadi/stateloom-protocol";

export interface LiveOutcome {
  ok: boolean;
  text: string;
  /** No bridge is configured: nothing was attempted. */
  off?: true;
}

export interface Live {
  /** Granular ops to a machine's room. `def` is what the file now holds. */
  patch(docId: string, ops: PatchOp[], def: unknown, mtime: number): Promise<LiveOutcome>;
  /** A whole document (ERD, sequence, system) to its room. */
  full(docId: string, def: unknown, mtime: number): Promise<LiveOutcome>;
  /** A view to a system's room; needs a connection, not a join. */
  view(view: Omit<ViewEnvelope, "origin"> & { origin?: string }): Promise<LiveOutcome>;
}

export interface LiveTarget {
  /** The hub. Undefined: every push reports that the bridge is not configured. */
  url?: string;
  token?: string;
  name?: string;
  /** How long to wait for the hub at each step. Default 3000 ms. */
  timeoutMs?: number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The hub's answer to a patch or a full: an ack with its seq, or an error frame. */
function answer(client: BridgeClient, ms: number): Promise<{ seq?: number; error?: string }> {
  return new Promise((resolve) => {
    const offs: (() => void)[] = [];
    const done = (r: { seq?: number; error?: string }): void => {
      clearTimeout(timer);
      for (const off of offs) off();
      resolve(r);
    };
    const timer = setTimeout(() => done({ error: `no answer from the hub in ${ms} ms` }), ms);
    offs.push(client.on("ack", (a) => done({ seq: a.seq })));
    offs.push(client.on("error", (e) => done({ error: e.message || e.code })));
  });
}

/** The hub said no: a refused token, or a frame it could not take. */
class Refused extends Error {}

/**
 * The first error frame the hub sends this client, as a rejection. A failed
 * connection is left to `connect()`, which rejects on it by itself.
 */
function refusal(client: BridgeClient): { promise: Promise<never>; off: () => void } {
  let off: () => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    off = client.on("error", (e) => {
      if (e.code !== "connect_error") reject(new Refused(e.message || e.code));
    });
  });
  promise.catch(() => {});
  return { promise, off };
}

export function liveBridge(target: LiveTarget): Live {
  const ms = target.timeoutMs ?? 3000;
  const unconfigured: LiveOutcome = {
    ok: false,
    off: true,
    text: "not live: the bridge is not configured (STATELOOM_BRIDGE_URL unset)",
  };
  const open = (docId: string): BridgeClient =>
    createBridgeClient({
      url: target.url!,
      role: "agent",
      docId,
      name: target.name ?? "mcp-agent",
      token: target.token,
      autoResync: false,
    });

  async function send(
    docId: string,
    def: unknown,
    kind: "patch" | "document",
    emit: (client: BridgeClient) => void,
  ): Promise<LiveOutcome> {
    if (!target.url) return unconfigured;
    const client = open(docId);
    const refused = refusal(client);
    try {
      const joined = await withTimeout(Promise.race([client.join(), refused.promise]), ms, "joining the room");
      const held = joined.snapshot?.def;
      if (held && hashDef(held) === hashDef(def as StateMachineDefinition)) {
        return { ok: true, text: "the room already holds it" };
      }
      const reply = answer(client, ms);
      emit(client);
      const r = await reply;
      return r.error
        ? { ok: false, text: `the hub refused the ${kind}: ${r.error}` }
        : { ok: true, text: `${kind} sent live (seq ${r.seq})` };
    } catch (e) {
      const why = e instanceof Refused ? `the hub refused the ${kind}: ${e.message}` : message(e);
      return { ok: false, text: `not live: ${why}; the file stands` };
    } finally {
      refused.off();
      client.disconnect();
    }
  }

  return {
    patch: (docId, ops, def, mtime) => send(docId, def, "patch", (c) => c.emitPatch(ops, mtime)),
    full: (docId, def, mtime) =>
      send(docId, def, "document", (c) => c.emitFull(def as StateMachineDefinition, mtime)),
    async view(view) {
      if (!target.url) return unconfigured;
      const client = open(view.docId);
      const refused = refusal(client);
      try {
        await withTimeout(
          Promise.race([client.emitView({ ...view, origin: view.origin ?? target.name ?? "agent" }), refused.promise]),
          ms,
          "reaching the hub",
        );
        // The hub acks no view, but it answers a refused one with an error
        // frame: wait a moment for that before calling the view delivered.
        await Promise.race([new Promise((r) => setTimeout(r, Math.min(ms, 250))), refused.promise]);
        return { ok: true, text: "view sent to the hub" };
      } catch (e) {
        return { ok: false, text: e instanceof Refused ? `the hub refused the view: ${e.message}` : `not sent: ${message(e)}` };
      } finally {
        refused.off();
        client.disconnect();
      }
    },
  };
}
