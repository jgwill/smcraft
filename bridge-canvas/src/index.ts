/**
 * @miadi/stateloom-canvas
 *
 * The SMDF design surface as a mountable React component: pan, zoom, drill,
 * drag, routed edges, settled labels, touch gestures and a navigation HUD —
 * driven entirely by props, styled entirely by CSS variables.
 *
 *     import { StateMachineCanvas } from "@miadi/stateloom-canvas";
 *     import "@miadi/stateloom-canvas/styles.css";
 *
 * The arithmetic underneath (`autoLayout`, `routeEdges`, `placeLabels`, the
 * viewport transforms) lives in `@miadi/stateloom-protocol` and is re-exported
 * here, so a host needs one dependency to draw a board rather than two.
 */
export { StateMachineCanvas, default } from "./StateMachineCanvas.js";
export type {
  CanvasSelection,
  CanvasTarget,
  DrawMode,
  StateMachineCanvasHandle,
  StateMachineCanvasProps,
} from "./StateMachineCanvas.js";

export { EntityRelationshipCanvas } from "./EntityRelationshipCanvas.js";
export type { EntityRelationshipCanvasProps, ErdCanvasTarget } from "./EntityRelationshipCanvas.js";

export { SequenceCanvas, drawableSequence } from "./SequenceCanvas.js";
export type {
  SequenceCanvasProps,
  SequenceCanvasTarget,
  SequenceSelection,
  SequenceTargetKind,
} from "./SequenceCanvas.js";

// The stage (Spec 83): a layer over any of the boards that lights what an
// agent points at and takes a person's marks, the caption that plays a tour,
// and the cards marks are written and read in.
export { StageOverlay, markAnchor } from "./StageOverlay.js";
export type { StageOverlayProps, MarkDraft } from "./StageOverlay.js";
export { StageCaption } from "./StageCaption.js";
export type { StageCaptionProps } from "./StageCaption.js";
export { MarkComposer, MarkThread, MarksPanel, MarkNotice } from "./MarkCards.js";
// Whether an agent's word has been read, per drawing in this browser, and
// what a marks button counts — for any host that shows marks (Miadi's room
// as the loom): `useMarksRead(doc)` + `unreadMarks(marks, read)` give the
// pins' and the list's `unread`; `markCounts(marks, read)` gives `forYou`
// (what waits on the person: the main number) and `forAgent` (the quiet one);
// `agentWordIn(envelope)` + `agentWordText(word)` turn a `marks:changed` that
// carries an agent's answer into the line for `<MarkNotice>`.
export { useMarksRead, loadMarksRead, saveMarksRead, marksReadKey } from "./marksRead.js";
// Talking with a companion from the canvas (Spec 84).
export { CompanionDock } from "./CompanionDock.js";
export type { CompanionDockProps, DockItem, DockReply, DockStep, DockTake } from "./CompanionDock.js";
export {
  MicIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  MarksIcon,
  MarkIcon,
  PlayIcon,
  PauseIcon,
  StopIcon,
  PrevIcon,
  NextIcon,
  ThumbUpIcon,
  ThumbDownIcon,
  CloseIcon,
} from "./icons.js";
export type { MarkComposerProps, MarkThreadProps, MarksPanelProps, MarkNoticeProps, ListenerLike } from "./MarkCards.js";

export { themeStyle, CANVAS_THEME_VARS } from "./theme.js";
export type { CanvasTheme } from "./theme.js";

export {
  childByName,
  childStatesAt,
  childrenOf,
  definedEvents,
  findState,
  livePath,
  parentAt,
} from "./drill.js";

// The geometry and the model, re-exported at the address a host reaching for a
// canvas is already looking at.
export {
  autoLayout,
  AUTO_LAYOUT_DEFAULTS,
  IDENTITY_VIEWPORT,
  VIEWPORT_LIMITS,
  clampScale,
  fitToBoxes,
  normalizeViewport,
  panBy,
  sameViewport,
  screenDeltaToWorld,
  screenToWorld,
  viewportTransform,
  worldToScreen,
  zoomAt,
  zoomTo,
  routeEdges,
  erdAutoLayout,
  erdEntitySize,
  sequenceLayout,
  placeLabels,
  eventGlyph,
  guardText,
  machineElementBoxes,
  erdElementBoxes,
  sequenceElementBoxes,
  elementsInRegion,
  elementAt,
  boxesOf,
  unionBox,
  marksWaitingOn,
  markCounts,
  unreadMarks,
  isMarkUnread,
  withMarkRead,
  lastWordOf,
  agentWordIn,
  agentWordText,
} from "@miadi/stateloom-protocol";
export type {
  AutoLayoutOptions,
  Box,
  EntityRelationshipDefinition,
  FitOptions,
  LayoutBox,
  Point,
  ScaleLimits,
  SequenceDefinition,
  SequenceLayout,
  StateDef,
  StateMachineDefinition,
  TransitionDef,
  Viewport,
  ElementBox,
  Mark,
  MarkKind,
  MarksRead,
  MarksEnvelope,
  AgentWord,
  TourStep,
  TourDefinition,
} from "@miadi/stateloom-protocol";
