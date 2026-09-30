import { closeSync, constants, lstatSync, openSync, readdirSync, readlinkSync, realpathSync, statSync, writeSync } from "fs";
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

/**
 * The chronicle's diagrams (D2, approved by Guillaume 2026-09-30 — the narrow
 * rule). A chronicle root, from STATELOOM_CHRONICLE_ROOT (SMCRAFT_ twin), admits
 * exactly one shape of path and nothing else under it:
 *
 *     <chronicleRoot>/<episode>/diagrams/<file>.json
 *
 * One episode directory, then `diagrams/`, then the file — not the episode's
 * other files, not the root's own files, nothing deeper. The shape is checked on
 * the REAL path, so a symlink in the episode or in `diagrams/` cannot lead out
 * of it; and since the real path of the parent is required, a new file can be
 * created only where `diagrams/` already exists. Nothing here makes a directory.
 */
export function chronicleRoot(): string | null {
  const raw = envAlias("CHRONICLE_ROOT");
  if (!raw) return null;
  try {
    return realpathSync(resolve(raw));
  } catch {
    return null; // a chronicle root that does not exist admits nothing
  }
}

/** Is this real path `<root>/<episode>/diagrams/<file>.json`, with `diagrams/` a real directory? */
export function isChronicleDiagram(real: string, root: string): boolean {
  if (!real.startsWith(root + sep)) return false;
  const parts = real.slice(root.length + 1).split(sep);
  if (parts.length !== 3) return false;
  const [episode, folder, file] = parts;
  if (!episode || episode.startsWith(".") || folder !== "diagrams") return false;
  if (!file || file.startsWith(".") || !file.endsWith(".json")) return false;
  try {
    return statSync(join(root, episode, folder)).isDirectory();
  } catch {
    return false;
  }
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

  if (doc.includes("\0")) {
    return { ok: false, error: "doc must not contain a NUL byte" };
  }

  const lexical = resolve(doc);
  // Where the request really lands, symlinks followed:
  // - an existing file (or a live link): its realpath;
  // - a DANGLING link: the path it points at — the write would follow it there,
  //   so that is what the roots must admit (the parent realpathed, as for a
  //   new file). A link that points at another link is refused outright.
  // - a new file: its realpathed parent plus its name.
  // A doc whose parent does not exist is refused; nothing here makes a directory.
  let anchored: string;
  try {
    let link: ReturnType<typeof lstatSync> | null = null;
    try {
      link = lstatSync(lexical);
    } catch {
      link = null;
    }
    if (link?.isSymbolicLink()) {
      try {
        anchored = realpathSync(lexical);
      } catch {
        const target = resolve(dirname(lexical), readlinkSync(lexical));
        let chained = false;
        try {
          chained = lstatSync(target).isSymbolicLink();
        } catch {
          chained = false;
        }
        if (chained) return { ok: false, error: `${doc} is a link to a link, which is not followed` };
        anchored = resolve(realpathSync(dirname(target)), basename(target));
      }
    } else if (link) {
      anchored = realpathSync(lexical);
    } else {
      anchored = resolve(realpathSync(dirname(lexical)), basename(lexical));
    }
  } catch {
    // Almost always a host path handed to a containerised server: the directory
    // exists where the human is looking and not where the server is.
    return { ok: false, error: outsideRootsMessage(doc, allowedDocRoots()) };
  }

  // Under the chronicle root only the chronicle rule decides — even when a doc
  // root contains it, or is it — so the narrow rule cannot be widened by a
  // broader root.
  const chronicle = chronicleRoot();
  if (chronicle && (anchored === chronicle || anchored.startsWith(chronicle + sep))) {
    return isChronicleDiagram(anchored, chronicle)
      ? { ok: true, path: anchored }
      : { ok: false, error: outsideRootsMessage(doc, allowedDocRoots()) };
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
 * Write a resolved document without following a link at the destination:
 * `O_NOFOLLOW` fails on a symlink in the last component, so a link placed there
 * after `resolveDocPath` looked cannot redirect the write. The parent was
 * realpathed by `resolveDocPath`. The file keeps its inode, so watchers and
 * hard links see an ordinary change.
 */
export function writeDocFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o666);
  try {
    writeSync(fd, content, 0, "utf8");
  } finally {
    closeSync(fd);
  }
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
  const chronicle = chronicleRoot();
  const where =
    (roots.length ? roots.join(", ") : "(no readable root is configured)") +
    (chronicle ? `, nor a chronicle diagram (${chronicle}/<episode>/diagrams/<file>.json, in an existing diagrams/ folder)` : "");
  const hint =
    roots.length === 1 && roots[0] === "/data"
      ? " — this server is in a container, and it sees your mounted directory as /data," +
        ` so ask for /data/${basename(doc)}`
      : "";
  return `${doc} is not under the permitted document root${roots.length === 1 ? "" : "s"} ${where}${hint}`;
}

/** How many episode folders, newest name first, and how many chronicle files the listing reads. */
const CHRONICLE_EPISODE_LIMIT = 400;
const CHRONICLE_FILE_LIMIT = 200;

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

  // Nothing under the chronicle root is listed by a doc root's walk: only the
  // chronicle rule admits there, and it is listed on its own below.
  const chronicle = chronicleRoot();
  const underChronicle = (real: string): boolean =>
    !!chronicle && (real === chronicle || real.startsWith(chronicle + sep));

  const walk = (dir: string, depth: number, root: string): void => {
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
      let real: string;
      let stat;
      try {
        real = realpathSync(full);
        stat = statSync(real);
      } catch {
        continue; // a broken symlink lists as nothing, not as a crash
      }
      // A link out of the root is neither listed nor descended: the listing
      // never names a path the file API would refuse.
      if (real !== root && !real.startsWith(root + sep)) continue;
      if (underChronicle(real)) continue;
      if (stat.isDirectory()) {
        if (depth < maxDepth) walk(real, depth + 1, root);
        continue;
      }
      if (!entry.endsWith(".json") || !real.endsWith(".json")) continue;
      if (docs.length >= limit) {
        truncated = true;
        return;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      docs.push({ path: real, name: basename(real), dir: dirname(real), size: stat.size, mtime: stat.mtimeMs });
    }
  };

  for (const root of allowedDocRoots()) walk(root, 0, root);

  // The chronicle's diagrams: `<episode>/diagrams/*.json` only, as the rule
  // admits them, and bounded on its own so a long chronicle neither crowds the
  // roots out of the list nor turns it into a crawl of every episode.
  if (chronicle) {
    let listed = 0;
    let episodes: string[] = [];
    try {
      episodes = readdirSync(chronicle).filter((e) => !e.startsWith(".")).sort().reverse().slice(0, CHRONICLE_EPISODE_LIMIT);
    } catch {
      episodes = [];
    }
    for (const episode of episodes) {
      if (listed >= CHRONICLE_FILE_LIMIT) {
        truncated = true;
        break;
      }
      const dir = join(chronicle, episode, "diagrams");
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        continue; // no diagrams/ folder: nothing of this episode is admitted
      }
      for (const file of files) {
        if (file.startsWith(".") || !file.endsWith(".json")) continue;
        const full = join(dir, file);
        let real: string;
        let stat;
        try {
          real = realpathSync(full);
          stat = statSync(real);
        } catch {
          continue;
        }
        // Listed only where the file API would serve it: never a path it refuses.
        if (!stat.isFile() || !isChronicleDiagram(real, chronicle) || seen.has(real)) continue;
        if (listed >= CHRONICLE_FILE_LIMIT) {
          truncated = true;
          break;
        }
        seen.add(real);
        docs.push({ path: real, name: file, dir: dirname(real), size: stat.size, mtime: stat.mtimeMs });
        listed += 1;
      }
    }
  }

  // The loom's own documents first (`.smdf.json` machines, `.erdf.json` ERDs,
  // `.sqdf.json` sequences, `.sysdf.json` systems) — the rest are `.json` files
  // the allowlist tolerates but nobody came here looking for — then most
  // recently touched.
  const rank = (name: string): number => (/\.(smdf|erdf|sqdf|sysdf)\.json$/i.test(name) ? 0 : 1);
  docs.sort((a, b) => rank(a.name) - rank(b.name) || b.mtime - a.mtime || a.path.localeCompare(b.path));

  return { docs, truncated };
}
