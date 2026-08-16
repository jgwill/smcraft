import { existsSync, readdirSync, realpathSync, statSync } from "fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
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
    // Almost always a host path handed to a containerised server: the directory
    // exists where the human is looking and not where the server is.
    return { ok: false, error: outsideRootsMessage(doc, allowedDocRoots()) };
  }

  const roots = allowedDocRoots();
  for (const root of roots) {
    if (anchored === root || anchored.startsWith(root + sep)) {
      return { ok: true, path: anchored };
    }
  }
  return { ok: false, error: outsideRootsMessage(doc, roots) };
}

/**
 * A refusal that is true from the READER's side.
 *
 * "doc is outside the allowed roots" and "doc directory does not exist" are both
 * accurate from the server's point of view and both false from the human's: in a
 * container they are looking straight at the directory, on the host, where it
 * plainly does exist. What they are missing is that the server sees it somewhere
 * else. So the message names the roots and, when they differ from the path being
 * asked for, says what the translation is.
 */
function outsideRootsMessage(doc: string, roots: string[]): string {
  const where = roots.length ? roots.join(", ") : "(no readable root is configured)";
  const hint =
    roots.length === 1 && roots[0] === "/data"
      ? " — this server is in a container, and it sees your mounted directory as /data," +
        ` so ask for /data/${basename(doc)}`
      : "";
  return `${doc} is not under the permitted document root${roots.length === 1 ? "" : "s"} ${where}${hint}`;
}

export interface DocEntry {
  /** Absolute path as the SERVER sees it — the value `?doc=` wants. */
  path: string;
  /** Basename, for display. */
  name: string;
  /** Directory, for display when two documents share a name. */
  dir: string;
  size: number;
  mtime: number;
}

/**
 * Every document the allowlist would admit, so the switcher can be a switcher.
 *
 * Both the compose file and `.env.docker.example` promised that other documents
 * in the mounted directory are "reachable from the canvas's document switcher".
 * That was true of the ALLOWLIST and false of the UI: recents came from this
 * browser's layout memory, empty on first use, and nothing enumerated the
 * directory — so switching meant knowing the container sees your folder as
 * /data and typing the path by hand, every time. (Found in review.)
 *
 * Bounded deliberately: depth and count caps, no dotfiles, no node_modules. A
 * mount pointed at a home directory must not turn a dropdown into a filesystem
 * crawl.
 */
export function listDocuments(limit = 300, maxDepth = 4): { docs: DocEntry[]; truncated: boolean } {
  const docs: DocEntry[] = [];
  const seen = new Set<string>();
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (docs.length >= limit) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // unreadable directory is not an error, it is just not listed
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue; // a broken symlink lists as nothing, not as a crash
      }
      if (stat.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1);
        continue;
      }
      if (!entry.endsWith(".json")) continue;
      if (docs.length >= limit) {
        truncated = true;
        return;
      }
      if (seen.has(full)) continue;
      seen.add(full);
      docs.push({ path: full, name: entry, dir, size: stat.size, mtime: stat.mtimeMs });
    }
  };

  for (const root of allowedDocRoots()) walk(root, 0);

  // `.smdf.json` first — the rest are `.json` files the allowlist tolerates but
  // nobody came here looking for — then most recently touched.
  docs.sort((a, b) => {
    const aSmdf = a.name.endsWith(".smdf.json") ? 0 : 1;
    const bSmdf = b.name.endsWith(".smdf.json") ? 0 : 1;
    return aSmdf - bSmdf || b.mtime - a.mtime || a.path.localeCompare(b.path);
  });

  return { docs, truncated };
}
