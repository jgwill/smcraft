"use client";

/**
 * The stage on the state designer's board (Spec 83): the level on the board,
 * its states and arrows as boxes, from the designer's store. A step that
 * lights a state on another level drills there first — the same focus an
 * agent's `show` gives.
 */
import { useMemo } from "react";
import { childStatesAt } from "@miadi/stateloom-canvas";
import { machineElementBoxes, parseFocus } from "@miadi/stateloom-protocol";
import { useDesignerStore } from "@/store/useDesignerStore";
import { useUrlParam, FOCUS_REQUEST_EVENT } from "@/lib/systemParam";
import StageLayer from "./StageLayer";

export default function MachineStageLayer() {
  const definition = useDesignerStore((s) => s.definition);
  const positions = useDesignerStore((s) => s.layout.positions);
  const navigationPath = useDesignerStore((s) => s.navigationPath);
  const viewport = useDesignerStore((s) => s.viewport);
  const setViewport = useDesignerStore((s) => s.setViewport);
  const docPath = useDesignerStore((s) => s.docPath);
  const focus = useUrlParam("focus");
  // The board is the page's element around the canvas; read when it is needed.
  const boardRef = useMemo(() => ({ get current() { return document.getElementById("machine-board"); } }), []);

  const path = navigationPath.slice(1);
  const boxes = useMemo(() => {
    if (!definition?.state) return [];
    return machineElementBoxes(childStatesAt(definition.state, path), positions);
    // `path` is derived from navigationPath, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, positions, navigationPath]);

  return (
    <StageLayer
      docPath={docPath}
      kind="machine"
      viewport={viewport}
      setViewport={setViewport}
      boxes={boxes}
      boardRef={boardRef}
      focus={focus}
      level={navigationPath[navigationPath.length - 1]}
      onReveal={(focuses) => {
        // Drill to the level of the first lit state: the focus machinery knows how.
        const state = focuses.map(parseFocus).find((f) => f?.kind === "state");
        if (!state) return;
        const url = new URL(window.location.href);
        url.searchParams.set("focus", `state:${state.name}`);
        window.history.replaceState(window.history.state, "", url);
        window.dispatchEvent(new Event(FOCUS_REQUEST_EVENT));
      }}
    />
  );
}
