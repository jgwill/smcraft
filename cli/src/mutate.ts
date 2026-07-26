/**
 * The durable-first mutate + emit core.
 *
 * INVARIANT: disk is the source of truth. Every mutation is first applied to
 * the on-disk definition (via the protocol's pure `applyPatchOps`) and
 * persisted; only then — best-effort — does the CLI open a short-lived bridge
 * client and echo the SAME op stamped with the freshly written file's mtime, so
 * live web/agent peers animate it. A missing or unreachable bridge NEVER fails
 * the command: persistence already succeeded and the file-watch differ will
 * reconcile any peer that reconnects.
 */
import {
  applyPatchOps,
  type PatchOp,
  type StateMachineDefinition,
} from "@miadi/stateloom-protocol";
import { createBridgeClient, type BridgeClient } from "@miadi/stateloom-client";
import { readDef, writeDef, mtimeOf } from "./docio.js";

export interface MutateCtx {
  doc: string;
  bridgeUrl?: string;
  name?: string;
  token?: string;
}

/** The seed definition when a project file does not yet exist. */
export const EMPTY_DEF: StateMachineDefinition = {
  settings: { namespace: "MyApp", name: "machine", asynchronous: false },
  events: [{ name: "Internal", events: [] }],
  state: { name: "Root", states: [] },
};

/** Resolve on the client's next `ack`, or after `ms` — whichever comes first. */
function waitAck(client: BridgeClient, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve();
    };
    const off = client.on("ack", () => finish());
    const timer = setTimeout(finish, ms);
    timer.unref?.();
  });
}

/**
 * Apply `ops` (or, when `opts.full`, a whole definition in `opts.def`) to the
 * on-disk def, persist it, then — if a bridge URL is configured — echo the same
 * change to live peers stamped with the new mtime.
 */
export async function applyAndEmit(
  ctx: MutateCtx,
  ops: PatchOp[],
  opts?: { full?: boolean; def?: StateMachineDefinition },
): Promise<void> {
  const cur = readDef(ctx.doc) ?? EMPTY_DEF;
  const next = opts?.full ? (opts.def ?? applyPatchOps(cur, ops)) : applyPatchOps(cur, ops);

  writeDef(ctx.doc, next);
  const mtime = mtimeOf(ctx.doc);

  if (!ctx.bridgeUrl) {
    console.log(`  · bridge not set — persisted to ${ctx.doc} (disk only)`);
    return;
  }

  try {
    const client = createBridgeClient({
      url: ctx.bridgeUrl,
      role: "cli",
      docId: ctx.doc,
      name: ctx.name,
      token: ctx.token,
    });
    await client.connect();
    await client.join();
    const acked = waitAck(client, 1500);
    if (opts?.full) client.emitFull(next, mtime);
    else client.emitPatch(ops, mtime);
    await acked;
    client.disconnect();
    console.log(`  · emitted ${opts?.full ? "def:full" : "def:patch"} → ${ctx.bridgeUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  · bridge unreachable at ${ctx.bridgeUrl} — persisted to disk only (${msg})`);
  }
}
