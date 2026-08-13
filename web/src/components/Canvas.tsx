"use client";

/**
 * The designer's board — now a binding rather than an implementation.
 *
 * Every pixel below used to live here: 1,300 lines of gesture bookkeeping,
 * edge routing, chip settling and touch heuristics, all of it reaching into
 * `useDesignerStore` for its truth. Forgewright then wanted the same board and
 * had no way to have it, because the board and the store were one object.
 *
 * So the surface moved out to `@miadi/stateloom-canvas`, prop-driven and
 * store-blind, and what remains here is the only part that was ever specific to
 * this application: which store field answers which prop. The behaviour is
 * unchanged — same wheel, same pinch, same held-press menu, same arrows — and
 * anything that improves in the package now reaches both applications at once.
 */

import { StateMachineCanvas } from "@miadi/stateloom-canvas";
import { useDesignerStore } from "@/store/useDesignerStore";
import { CANVAS_PINCH_OWNER } from "@/lib/gestureOwner";
import { CANVAS_SVG_ID } from "@/lib/exportImage";
import { useLayoutMemory } from "@/lib/layoutMemory";

export default function Canvas() {
  const definition = useDesignerStore((s) => s.definition);
  const layout = useDesignerStore((s) => s.layout);
  const selection = useDesignerStore((s) => s.selection);
  const select = useDesignerStore((s) => s.select);
  const clearSelection = useDesignerStore((s) => s.clearSelection);
  const setStatePosition = useDesignerStore((s) => s.setStatePosition);
  const drawMode = useDesignerStore((s) => s.drawMode);
  const drawSource = useDesignerStore((s) => s.drawSource);
  const setDrawSource = useDesignerStore((s) => s.setDrawSource);
  const setDrawMode = useDesignerStore((s) => s.setDrawMode);
  const addTransition = useDesignerStore((s) => s.addTransition);
  const showContextMenu = useDesignerStore((s) => s.showContextMenu);
  const removeState = useDesignerStore((s) => s.removeState);
  const undo = useDesignerStore((s) => s.undo);
  const redo = useDesignerStore((s) => s.redo);
  const errors = useDesignerStore((s) => s.errors);
  const navigationPath = useDesignerStore((s) => s.navigationPath);
  const navigateInto = useDesignerStore((s) => s.navigateInto);
  const navigateUp = useDesignerStore((s) => s.navigateUp);
  const activeStates = useDesignerStore((s) => s.activeStates);
  const viewport = useDesignerStore((s) => s.viewport);
  const setViewport = useDesignerStore((s) => s.setViewport);

  // Remembered board: restore this browser's drags, then keep writing them back.
  useLayoutMemory();

  // The store's breadcrumb carries the root name at index 0; the canvas takes
  // the path *below* the root and names the root itself separately. `navigateUp`
  // indexes the full path, which is exactly what the breadcrumb hands back.
  const path = navigationPath.slice(1);

  return (
    <StateMachineCanvas
      definition={definition}
      positions={layout.positions}
      path={path}
      rootLabel={navigationPath[0]}
      viewport={viewport}
      onViewportChange={setViewport}
      // The store also knows about a selected *event*, which is a sidebar
      // concern with nothing on the board to outline.
      selection={{
        kind: selection.kind === "state" || selection.kind === "transition" ? selection.kind : null,
        id: selection.id,
      }}
      activeStates={activeStates}
      errorElements={errors.flatMap((e) => (e.element ? [e.element] : []))}
      drawMode={drawMode === "transition" ? "transition" : "select"}
      drawSource={drawSource}
      svgId={CANVAS_SVG_ID}
      pinchOwner={CANVAS_PINCH_OWNER}
      emptyHint={
        typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
          ? "Press and hold to add a state, or load a .smdf.json file"
          : "Right-click to add a state, or load a .smdf.json file"
      }
      onSelect={(kind, id) => {
        // In draw mode the first click on a box names the source of the
        // transition rather than selecting it.
        if (kind === "state" && drawMode === "transition" && !drawSource) {
          setDrawSource(id);
          return;
        }
        select(kind, id);
      }}
      onClearSelection={clearSelection}
      onStateMove={setStatePosition}
      onNavigateInto={navigateInto}
      onNavigateTo={(depth) => navigateUp(depth)}
      onContextMenu={(x, y, target) =>
        showContextMenu(
          x,
          y,
          target.kind === "state" ? { kind: "state", id: target.id } : { kind: "canvas" }
        )
      }
      onCreateTransition={(from, to, event) => {
        addTransition(from, { event, nextState: to });
        setDrawSource(null);
        setDrawMode("select");
      }}
      onCancelDraw={() => {
        setDrawMode("select");
        setDrawSource(null);
      }}
      onDeleteState={(name) => {
        removeState(name);
        clearSelection();
      }}
      onUndo={undo}
      onRedo={redo}
    />
  );
}
