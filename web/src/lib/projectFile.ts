import { existsSync, realpathSync } from "fs";
import { dirname, isAbsolute, resolve, sep } from "path";
import { envAlias } from "@miadi/stateloom-protocol";

export function getProjectFilePath(): string {
  return resolve(envAlias("PROJECT_FILE") ?? "./statemachine.smdf.json");
}

/**
 * Optional-document resolution for the file API (chart chart_1785683022927).
 *
 * The guard is not deferrable and ships in the same change as the parameter:
 * the canvas binds beyond loopback and PUT /api/file writes to disk, so an
 * unconstrained path parameter would be arbitrary file write across the
 * tailnet. A `doc` is admitted only when it is an absolute `.json` path whose
 * real location sits under an allowed root.
 *
 * Roots come from STATELOOM_DOC_ROOTS (SMCRAFT_ twin honored), colon-
 * separated absolute paths. Unset, the allowlist is exactly the directory of
 * the default project file — the pre-parameter surface, unchanged.
 */
export function allowedDocRoots(): string[] {
  const raw = envAlias("DOC_ROOTS");
  const roots = raw
    ? raw.split(":").map((r) => r.trim()).filter(Boolean)
    : [dirname(getProjectFilePath())];
  const real: string[] = [];
  for (const root of roots) {
    try {
      real.push(realpathSync(resolve(root)));
    } catch {
      // A configured root that does not exist admits nothing — skipped, not fatal.
    }
  }
  return real;
}

export type DocResolution =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** Resolve an optional `doc` request parameter to an admitted absolute path.
 *  No doc → the default project file, byte-identical to the old behavior. */
export function resolveDocPath(doc: string | null | undefined): DocResolution {
  if (!doc) return { ok: true, path: getProjectFilePath() };

  if (!isAbsolute(doc)) {
    return { ok: false, error: "doc must be an absolute path" };
  }
  if (!doc.endsWith(".json")) {
    return { ok: false, error: "doc must name a .json document" };
  }

  const lexical = resolve(doc);
  // Realpath the file itself when it exists (GET/PUT of a known doc), else its
  // parent (PUT may create the file) — symlinks cannot smuggle a path outside
  // the allowlist either way. A doc whose parent does not exist is refused.
  let anchored: string;
  try {
    anchored = existsSync(lexical)
      ? realpathSync(lexical)
      : resolve(realpathSync(dirname(lexical)), lexical.slice(lexical.lastIndexOf(sep) + 1));
  } catch {
    return { ok: false, error: "doc directory does not exist" };
  }

  for (const root of allowedDocRoots()) {
    if (anchored === root || anchored.startsWith(root + sep)) {
      return { ok: true, path: anchored };
    }
  }
  return { ok: false, error: "doc is outside the allowed roots" };
}
