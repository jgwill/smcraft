/**
 * The spotlight: what someone is being shown on a board.
 *
 * A host names elements with the focus strings the system already uses
 * (`<kind>:<name>`, Spec 82): `state:Recording`, `transition:Idle:0`,
 * `event:submit`, `entity:WaveCount`, `participant:Chart`, `message:9`. The
 * canvases draw those with the spotlight ring and dim the rest of the level.
 * An empty list dims nothing, so a board without a spotlight draws as before.
 */
export interface SpotlightSet {
  /** True when at least one element is named: the rest of the board dims. */
  on: boolean;
  has(kind: string, name: string): boolean;
}

const OFF: SpotlightSet = { on: false, has: () => false };

export function spotlightSet(focus: readonly string[] | undefined | null): SpotlightSet {
  if (!focus || focus.length === 0) return OFF;
  const keys = new Set<string>();
  for (const f of focus) {
    const i = f.indexOf(":");
    if (i > 0) keys.add(f);
  }
  if (keys.size === 0) return OFF;
  return { on: true, has: (kind, name) => keys.has(`${kind}:${name}`) };
}

/** The class an element takes under a spotlight: lit, dimmed, or nothing. */
export function spotClass(set: SpotlightSet, lit: boolean): string {
  if (!set.on) return "";
  return lit ? "slc-spot" : "slc-dim";
}
