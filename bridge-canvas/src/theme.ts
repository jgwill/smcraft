/**
 * What the canvas looks like, expressed as CSS custom properties.
 *
 * Every colour the board paints is read from a `--slc-*` variable declared on
 * the canvas pane, never written into an SVG `fill=` attribute. That single
 * rule is what makes the surface portable: the stylesheet ships one dark
 * default set, and a host application re-skins the entire board — nodes,
 * edges, chips, HUD — by declaring the same variables on any ancestor, or by
 * handing a partial `theme` to the component.
 *
 * The names are the contract. They are stable, and a host that overrides one
 * it does not recognise simply has no effect rather than an error.
 */

export interface CanvasTheme {
  /** The board itself. */
  surface: string;
  /** Ordinary state box fill / stroke. */
  nodeFill: string;
  nodeStroke: string;
  /** A state that owns children. */
  compositeFill: string;
  /** A final state. */
  finalFill: string;
  /** The selected element — box outline, edge, chip. */
  accent: string;
  accentFill: string;
  accentInk: string;
  /** A state failing validation. */
  danger: string;
  /** The state a transition is being drawn from. */
  drawSource: string;
  /** Edges and their arrowheads. */
  edge: string;
  /** Chip plate under an event label. */
  chipFill: string;
  chipStroke: string;
  /** Text. */
  label: string;
  muted: string;
  faint: string;
  /** `onEntry` / `onExit` markers on a box. */
  entry: string;
  exit: string;
  /** The drill-down hint under a composite. */
  composite: string;
  /** Runtime-active glow. */
  active: string;
  /** Floating chrome: HUD, breadcrumb, event picker. */
  panelBg: string;
  panelBorder: string;
  panelHover: string;
}

/** The variable name a theme key is written to. */
const VAR: Record<keyof CanvasTheme, string> = {
  surface: "--slc-surface",
  nodeFill: "--slc-node-fill",
  nodeStroke: "--slc-node-stroke",
  compositeFill: "--slc-composite-fill",
  finalFill: "--slc-final-fill",
  accent: "--slc-accent",
  accentFill: "--slc-accent-fill",
  accentInk: "--slc-accent-ink",
  danger: "--slc-danger",
  drawSource: "--slc-draw-source",
  edge: "--slc-edge",
  chipFill: "--slc-chip-fill",
  chipStroke: "--slc-chip-stroke",
  label: "--slc-label",
  muted: "--slc-muted",
  faint: "--slc-faint",
  entry: "--slc-entry",
  exit: "--slc-exit",
  composite: "--slc-composite",
  active: "--slc-active",
  panelBg: "--slc-panel-bg",
  panelBorder: "--slc-panel-border",
  panelHover: "--slc-panel-hover",
};

/**
 * Turn a partial theme into the inline style that carries it.
 *
 * Only the keys given are emitted, so anything left out keeps whatever the
 * stylesheet — or an ancestor's own declaration — already says.
 */
export function themeStyle(theme?: Partial<CanvasTheme>): Record<string, string> {
  const style: Record<string, string> = {};
  if (!theme) return style;
  for (const [key, value] of Object.entries(theme)) {
    const name = VAR[key as keyof CanvasTheme];
    if (name && typeof value === "string") style[name] = value;
  }
  return style;
}

/** The variable names, for a host that would rather write CSS than props. */
export const CANVAS_THEME_VARS: Readonly<Record<keyof CanvasTheme, string>> = VAR;
