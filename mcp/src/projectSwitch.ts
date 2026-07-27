/**
 * Pure logic behind the `set_project_file` MCP tool (path power — the agent
 * chooses which `.smdf.json` document the loom weaves).
 */
import { existsSync } from "fs";
import { resolve } from "path";

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

export function resolveProjectSwitch(next: string, previous: string): SwitchResult {
  const path = resolve(next);
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
