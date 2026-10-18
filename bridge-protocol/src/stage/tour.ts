/**
 * Tours as data (Spec 83): check one, resolve its paths, time its steps.
 */
import { resolveMemberPath } from "../system/definition.js";
import { parseFocus } from "../system/check.js";
import type { Box } from "../viewport.js";
import type { TourDefinition, TourStep } from "./definition.js";

export interface TourValidationError {
  ruleId: string;
  message: string;
  /** The step it is about (0-based), when it is about one. */
  step?: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function boxProblem(region: unknown): string | null {
  if (!region || typeof region !== "object") return "region is { x, y, width, height }";
  const r = region as Partial<Box>;
  if (![r.x, r.y, r.width, r.height].every(finite)) return "region needs finite x, y, width and height";
  if ((r.width as number) <= 0 || (r.height as number) <= 0) return "region needs a positive width and height";
  return null;
}

/**
 * The problems of one step, as rule ids:
 *
 * - T003 a step says something (`say`)
 * - T004 `focus` is `<kind>:<name>`
 * - T005 each `spotlight` entry is `<kind>:<name>`
 * - T006 `region` is a box with a positive size
 * - T007 `doc` and `system` are `.json` paths; `system` a `.sysdf.json`
 * - T008 `holdMs` is a non-negative number
 * - T009 `audio` is an `http(s)` URL or an absolute path
 */
export function validateStep(step: TourStep, index?: number): TourValidationError[] {
  const out: TourValidationError[] = [];
  const at = (ruleId: string, message: string) => out.push({ ruleId, message, ...(index !== undefined ? { step: index } : {}) });
  const s = (step && typeof step === "object" ? step : {}) as Partial<TourStep>;
  if (typeof s.say !== "string" || !s.say.trim()) at("T003", "a step says something: say is empty");
  if (s.focus !== undefined && (typeof s.focus !== "string" || !parseFocus(s.focus))) {
    at("T004", `focus is <kind>:<name> (got '${String(s.focus)}')`);
  }
  if (s.spotlight !== undefined) {
    if (!Array.isArray(s.spotlight)) at("T005", "spotlight is a list of <kind>:<name>");
    else for (const e of s.spotlight) if (typeof e !== "string" || !parseFocus(e)) at("T005", `spotlight entries are <kind>:<name> (got '${String(e)}')`);
  }
  if (s.region !== undefined) {
    const p = boxProblem(s.region);
    if (p) at("T006", p);
  }
  if (s.doc !== undefined && (typeof s.doc !== "string" || !s.doc.toLowerCase().endsWith(".json"))) {
    at("T007", `doc names a .json drawing (got '${String(s.doc)}')`);
  }
  if (s.system !== undefined && (typeof s.system !== "string" || !s.system.toLowerCase().endsWith(".sysdf.json"))) {
    at("T007", `system names a .sysdf.json (got '${String(s.system)}')`);
  }
  if (s.holdMs !== undefined && (!finite(s.holdMs) || s.holdMs < 0)) at("T008", "holdMs is a number of milliseconds, 0 or more");
  if (s.audio !== undefined && (typeof s.audio !== "string" || !/^(https?:\/\/|\/)/.test(s.audio))) {
    at("T009", `audio is an http(s) URL or an absolute path (got '${String(s.audio)}')`);
  }
  return out;
}

/** T001 the tour has a name; T002 it has steps; then each step's own rules. */
export function validateTour(def: TourDefinition): TourValidationError[] {
  const out: TourValidationError[] = [];
  const d = (def && typeof def === "object" ? def : {}) as Partial<TourDefinition>;
  if (!d.settings || typeof d.settings.name !== "string" || !d.settings.name.trim()) {
    out.push({ ruleId: "T001", message: "a tour has a name: settings.name is empty" });
  }
  if (!Array.isArray(d.steps) || d.steps.length === 0) {
    out.push({ ruleId: "T002", message: "a tour has at least one step" });
    return out;
  }
  d.steps.forEach((step, i) => out.push(...validateStep(step, i)));
  return out;
}

/** A step with its `doc` and `system` made absolute against the tour file (or any base path). */
export function resolveStepPaths(step: TourStep, basePath: string): TourStep {
  return {
    ...step,
    ...(step.doc ? { doc: resolveMemberPath(basePath, step.doc) } : {}),
    ...(step.system ? { system: resolveMemberPath(basePath, step.system) } : {}),
  };
}

/** Every step's paths made absolute: what the canvases are sent. */
export function resolveTourPaths(def: TourDefinition, tourPath: string): TourDefinition {
  return { ...def, steps: def.steps.map((s) => resolveStepPaths(s, tourPath)) };
}

/**
 * The drawing a step shows, carrying the previous step's forward: a step with
 * no `doc` stays on the drawing the tour was already on.
 */
export function stepDocs(def: TourDefinition, start?: string): (string | undefined)[] {
  let current = start;
  return def.steps.map((s) => (current = s.doc ?? current));
}

/** Words read aloud take about 400 ms each (150 a minute), plus a breath. */
const MS_PER_WORD = 400;
const MIN_HOLD = 2500;
const MAX_HOLD = 20000;

/** How long a step stays when nothing is spoken: its own `holdMs`, else estimated from its words. */
export function stepHoldMs(step: TourStep): number {
  if (finite(step.holdMs) && step.holdMs >= 0) return step.holdMs;
  const words = `${step.title ?? ""} ${step.say ?? ""}`.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(MAX_HOLD, Math.max(MIN_HOLD, 1200 + words * MS_PER_WORD));
}

/** One line per step, for an agent reading a tour back. */
export function summarizeTour(def: TourDefinition): string {
  const lines = [`tour ${def.settings?.namespace ? `${def.settings.namespace}.` : ""}${def.settings?.name ?? ""}: ${def.steps?.length ?? 0} step(s)`];
  (def.steps ?? []).forEach((s, i) => {
    const what = [s.doc ? s.doc.split("/").pop() : null, s.focus, s.spotlight?.length ? `spotlight ${s.spotlight.join(", ")}` : null, s.region ? "an area" : null]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${i + 1}. ${s.title ? `${s.title} — ` : ""}${(s.say ?? "").slice(0, 120)}${what ? `  [${what}]` : ""}`);
  });
  return lines.join("\n");
}
