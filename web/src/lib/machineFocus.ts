"use client";

/**
 * `focus=` for the state designer (Spec 82): `state:X` drills to X's level,
 * selects it and centres it; `event:E` does the same for the first transition
 * that fires E; `machine:*` (and anything else) leaves the board as it is.
 *
 * And the other way: when a person selects a state or a transition, the URL's
 * focus follows, so the system strip can list what that element links to.
 *
 * Kept as one hook beside the store rather than inside it, so the state
 * designer changes by the single line that mounts it.
 */
import { useEffect, useRef } from "react";
import { fitToBoxes, parseFocus, type StateDef, type StateMachineDefinition } from "@miadi/stateloom-protocol";
import { useDesignerStore } from "@/store/useDesignerStore";
import { CANVAS_SVG_ID } from "@/lib/exportImage";
import { urlParam, useFocusRequest, writeFocus } from "@/lib/systemParam";

const kids = (s: StateDef): StateDef[] => (s.parallel ? s.parallel.states : (s.states ?? []));

/** Names from the root down to `name`, inclusive; null when it is not in the tree. */
function chainTo(root: StateDef | undefined, name: string): string[] | null {
  if (!root) return null;
  if (root.name === name) return [root.name];
  for (const child of kids(root)) {
    const below = chainTo(child, name);
    if (below) return [root.name, ...below];
  }
  return null;
}

/** The first transition, in document order, that fires `event`. */
function firstTransition(root: StateDef | undefined, event: string): { state: string; index: number } | null {
  if (!root) return null;
  const i = (root.transitions ?? []).findIndex((t) => t?.event === event);
  if (i >= 0) return { state: root.name, index: i };
  for (const child of kids(root)) {
    const hit = firstTransition(child, event);
    if (hit) return hit;
  }
  return null;
}

function transitionEvent(def: StateMachineDefinition, id: string): string | null {
  const cut = id.lastIndexOf(":");
  const chain = chainTo(def.state, id.slice(0, cut));
  if (!chain) return null;
  let s: StateDef | undefined = def.state;
  for (const name of chain.slice(1)) s = kids(s!).find((k) => k.name === name);
  return s?.transitions?.[Number(id.slice(cut + 1))]?.event ?? null;
}

export function useMachineFocus(): void {
  const request = useFocusRequest();
  const pending = useRef<{ focus: string; docAt: string | null; defAt: StateMachineDefinition } | null>(null);

  useEffect(() => {
    const tryApply = (): void => {
      const p = pending.current;
      if (!p) return;
      const s = useDesignerStore.getState();
      const doc = urlParam("doc");
      // Not the requested document yet, or still its predecessor's definition.
      if (doc && s.docPath !== doc) return;
      if (p.docAt !== s.docPath && s.definition === p.defAt) return;
      pending.current = null;

      const f = parseFocus(p.focus);
      if (!f) return;
      let chain: string[] | null = null;
      let select: { kind: "state" | "transition"; id: string } | null = null;
      if (f.kind === "state") {
        chain = chainTo(s.definition.state, f.name);
        if (chain) select = { kind: "state", id: f.name };
      } else if (f.kind === "event") {
        const hit = firstTransition(s.definition.state, f.name);
        if (hit) {
          chain = chainTo(s.definition.state, hit.state);
          select = { kind: "transition", id: `${hit.state}:${hit.index}` };
        }
      }
      if (!chain || !select) return;
      // The level that draws the element: its parent's children.
      const level = chain.length > 1 ? chain.slice(0, -1) : chain;
      useDesignerStore.setState({ navigationPath: level, currentParent: level[level.length - 1] });
      s.select(select.kind, select.id);

      const centre = (): void => {
        const box = useDesignerStore.getState().layout.positions[chain![chain!.length - 1]];
        const rect = document.getElementById(CANVAS_SVG_ID)?.getBoundingClientRect();
        if (!box || !rect?.width) return;
        const vp = fitToBoxes([box], rect.width, rect.height, { padding: 60, maxScale: 1 });
        useDesignerStore.getState().setViewport(vp);
      };
      // Once when the board has drawn the level, and once more after this
      // browser's remembered view has had its chance to land on top.
      requestAnimationFrame(centre);
      setTimeout(centre, 450);
    };

    if (request.nonce > 0) {
      const s = useDesignerStore.getState();
      pending.current = request.focus ? { focus: request.focus, docAt: s.docPath, defAt: s.definition } : null;
      tryApply();
    }
    return useDesignerStore.subscribe(tryApply);
  }, [request]);

  // A person's selection becomes the focus. Clearing it leaves the last one in
  // the URL: the strip keeps listing what was last in hand.
  useEffect(
    () =>
      useDesignerStore.subscribe((state, prev) => {
        if (state.selection === prev.selection || !state.selection.id) return;
        const { kind, id } = state.selection;
        if (kind === "state") writeFocus(`state:${id}`);
        else if (kind === "event") writeFocus(`event:${id}`);
        else if (kind === "transition") {
          const event = transitionEvent(state.definition, id);
          if (event) writeFocus(`event:${event}`);
        }
      }),
    [],
  );
}
