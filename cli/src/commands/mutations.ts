/**
 * Thin mutation commands: each builds a single `PatchOp` (or a full-def load)
 * and delegates to the durable-first `applyAndEmit` core. Command logic lives
 * here — not inside commander closures — so it stays directly testable.
 */
import { resolve } from "node:path";
import type { PatchOp } from "@smcraft/bridge-protocol";
import { applyAndEmit, type MutateCtx } from "../mutate.js";
import { readDef } from "../docio.js";

/** Add a state under `parent` (default `Root`). */
export async function addState(
  name: string,
  opts: { parent?: string; kind?: string; desc?: string },
  ctx: MutateCtx,
): Promise<void> {
  const parent = opts.parent ?? "Root";
  const op: PatchOp = {
    op: "state.add",
    parent,
    state: {
      name,
      kind: (opts.kind as "normal" | "final" | "history" | undefined) ?? "normal",
      description: opts.desc,
    },
  };
  await applyAndEmit(ctx, [op]);
  console.log(`+ state "${name}" under "${parent}"`);
}

/** Add an event to event source `source` (default index 0). */
export async function addEvent(
  id: string,
  opts: { source?: number; desc?: string },
  ctx: MutateCtx,
): Promise<void> {
  const sourceIndex = opts.source ?? 0;
  const op: PatchOp = {
    op: "event.add",
    sourceIndex,
    event: { id, description: opts.desc },
  };
  await applyAndEmit(ctx, [op]);
  console.log(`+ event "${id}" on source #${sourceIndex}`);
}

/** Add a transition from `state` on `event`, optionally targeting `to` under guard `when`. */
export async function addTransition(
  state: string,
  event: string,
  opts: { to?: string; when?: string },
  ctx: MutateCtx,
): Promise<void> {
  const op: PatchOp = {
    op: "transition.add",
    state,
    transition: { event, nextState: opts.to, condition: opts.when },
  };
  await applyAndEmit(ctx, [op]);
  console.log(`+ transition ${state} ─[${event}]→ ${opts.to ?? "(internal)"}`);
}

/** Remove a state by name. */
export async function removeState(name: string, ctx: MutateCtx): Promise<void> {
  const op: PatchOp = { op: "state.remove", name };
  await applyAndEmit(ctx, [op]);
  console.log(`- state "${name}"`);
}

/** Load a whole definition from `file` into the ctx doc as a full replacement. */
export async function loadFile(file: string, ctx: MutateCtx): Promise<void> {
  const src = resolve(file);
  const def = readDef(src);
  if (!def) throw new Error(`load: cannot read a definition from ${src}`);
  await applyAndEmit(ctx, [], { full: true, def });
  console.log(`↺ loaded ${src} → ${ctx.doc}`);
}
