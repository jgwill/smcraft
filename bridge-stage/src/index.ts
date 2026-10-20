/**
 * @miadi/stateloom-stage
 *
 * A stage for stateloom drawings. An agent's tour plays on it like a short
 * presentation — the camera moves to what each step lights, a caption shows
 * the words, the browser's voice may say them. A person's taps and words on
 * it become marks the agent reads on its next turn.
 *
 *     import { DiagramStage } from "@miadi/stateloom-stage";
 *     import "@miadi/stateloom-canvas/styles.css";
 *     import "@miadi/stateloom-stage/styles.css";
 *
 * The live hook (`useLoomCue`, an agent's `show` through the hub) is at
 * `@miadi/stateloom-stage/live`, so a host that only plays tours never loads
 * socket.io.
 */
export { DiagramStage, default } from "./DiagramStage.js";
export type { DiagramStageProps, StageCue, StageShowing } from "./DiagramStage.js";
export { loadDrawing, drawingLabel } from "./drawing.js";
export type { StageDrawing, LoadedDrawing } from "./drawing.js";
export { browserSpeaker, canListen, listen } from "./speech.js";
export type { Speaker, Listening } from "./speech.js";
export { moveCamera, lerpViewport, CAMERA_MS } from "./camera.js";

// The formats, at the address a host reaching for the stage is already looking at.
export {
  TOUR_FORMAT,
  MARK_FORMAT,
  TOUR_EXTENSION,
  MARKS_FILE,
  MARK_KINDS,
  isTourPath,
  readTour,
  tourMembers,
  stepSpeech,
  readMarks,
  markFromDraft,
  markLine,
  describeMark,
} from "@miadi/stateloom-protocol";
export type { StageTour, TourStep, StageMark, MarkDraft, MarkKind, MarkStatus } from "@miadi/stateloom-protocol";
