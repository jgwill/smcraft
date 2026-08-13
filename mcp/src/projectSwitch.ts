/**
 * Pure logic behind the `set_project_file` MCP tool (path power — the agent
 * chooses which `.smdf.json` document the loom weaves).
 *
 * Two modalities, by William's orientation (2026-08-07): STANDALONE — a plain
 * path, no episode, just designing — and RELATIONAL — the document lives
 * inside a chronicle episode and is addressed as
 * `miadi-chronicle://<episode>/<diagram>`, resolving over
 * $MIADI_CHRONICLE_ROOT to `<episode-dir>/diagrams/<diagram>.smdf.json`.
 * The relationship is carried by WHERE the file lives (the scalar truth of
 * jgwill/Miadi#593); wheel edges stay derived/ceremonial, never minted here.
 */
import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

export interface SwitchResult {
  /** Absolute path of the newly active document. */
  path: string;
  /** The previously active absolute path. */
  previous: string;
  /** Whether a file already exists at the new path (missing is fine). */
  exists: boolean;
  /** True when the new path equals the previous one. */
  unchanged: boolean;
}

const CHRONICLE_SCHEME = /^miadi-chronicle:\/\//i;

export function chronicleRoot(env: Record<string, string | undefined> = process.env): string {
  return env.MIADI_CHRONICLE_ROOT ?? "/srv/miadi/episodes/miadi-chronicle";
}

/**
 * Resolve `miadi-chronicle://<episode>/[diagrams/]<name>[.smdf.json]` to the
 * absolute path `<root>/<episode-dir>/diagrams/<name>.smdf.json`.
 *
 * Episode matching: exact folder name first; else a bare number matches
 * `-episode-NNN-` folders. Episode numbers are NOT unique in the chronicle
 * (011, 016, 043, 078, 083, 098, 120 are doubled) — ambiguity is a HARD
 * ERROR naming every candidate, never a silent first match: a resolver that
 * guesses writes the wrong episode into the record. A missing diagram file
 * stays legitimate — naming it is how an episode's FIRST diagram is created.
 */
export function resolveChronicleUri(
  uri: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const rest = uri.replace(CHRONICLE_SCHEME, "").replace(/[?#].*$/, "");
  const segments = rest.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(
      `chronicle address needs <episode>/<diagram> (got '${uri}') — e.g. miadi-chronicle://103/film-preprod`,
    );
  }
  const episodeRef = segments[0];
  const name = segments[segments.length - 1];

  const root = chronicleRoot(env);
  let dirs: string[];
  try {
    dirs = readdirSync(root).filter((d) => {
      try {
        return statSync(join(root, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    throw new Error(`chronicle root not readable: ${root} (MIADI_CHRONICLE_ROOT)`);
  }

  let matches = dirs.filter((d) => d === episodeRef);
  if (matches.length === 0 && /^\d+$/.test(episodeRef)) {
    const num = String(parseInt(episodeRef, 10));
    matches = dirs.filter((d) => {
      const m = d.match(/-episode-0*(\d+)-/);
      return m !== null && m[1] === num;
    });
  }
  if (matches.length === 0) {
    throw new Error(`no episode matches '${episodeRef}' under ${root}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `episode '${episodeRef}' is ambiguous — candidates:\n  ${matches.sort().join("\n  ")}\nName the full folder.`,
    );
  }

  const file = name.endsWith(".json") ? name : `${name}.smdf.json`;
  return join(root, matches[0], "diagrams", file);
}

export function resolveProjectSwitch(next: string, previous: string): SwitchResult {
  const path = CHRONICLE_SCHEME.test(next) ? resolveChronicleUri(next) : resolve(next);
  if (!path.endsWith(".json")) {
    throw new Error(
      `project file must be a .json document (got '${path}') — the loom weaves .smdf.json files`,
    );
  }
  return {
    path,
    previous,
    exists: existsSync(path),
    unchanged: path === previous,
  };
}
