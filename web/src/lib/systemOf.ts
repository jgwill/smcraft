import { readFileSync, readdirSync, realpathSync } from "fs";
import { dirname, join, sep } from "path";
import { isSysdfPath, isSystemDefinition, resolveMemberPath } from "@miadi/stateloom-protocol";
import { allowedDocRoots, chronicleRoot, resolveDocPath } from "./projectFile";

/** How many folders above the document are searched. */
const SEARCH_DEPTH = 8;

const realOr = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Could the file API serve something in `dir`, or in a folder below it? */
function underAnAdmittedRoot(dir: string): boolean {
  const roots = allowedDocRoots();
  const chronicle = chronicleRoot();
  if (chronicle) roots.push(chronicle);
  return roots.some((root) => dir === root || dir.startsWith(root + sep));
}

export type SystemOfResult = { ok: true; doc: string; system: string | null } | { ok: false; error: string };

/** The admitted, readable system at `path` lists `target`: its resolved path, else null. */
function listing(path: string, target: string): string | null {
  const candidate = resolveDocPath(path);
  if (!candidate.ok || !isSysdfPath(candidate.path)) return null;
  let def: unknown;
  try {
    def = JSON.parse(readFileSync(candidate.path, "utf8"));
  } catch {
    return null;
  }
  if (!isSystemDefinition(def)) return null;
  const listed = def.members.some((m) => !!m?.path && realOr(resolveMemberPath(candidate.path, m.path)) === target);
  return listed ? candidate.path : null;
}

/**
 * The system that lists `doc` (Spec 82), so a drawing opened alone (`?doc=`
 * with no `system=`, the link an agent prints) is still read as a member of its
 * system and the strip can lead back to the map and to the other drawings.
 *
 * `preferred` (the `system=` already in the URL) answers when it lists the
 * document: a drawing two systems share stays in the one the person came from.
 * Otherwise the rule is the MCP's (`systemFor` in mcp/src/system.ts): the first
 * `.sysdf.json`, in name order, in the document's own folder and then in each
 * parent folder, that names the document as a member. Every candidate goes
 * through `resolveDocPath`, so this reads only systems the file API would serve
 * and never names a path it refuses. The walk stops at the admitted roots.
 */
export function systemOfDoc(doc: string, preferred?: string | null): SystemOfResult {
  const resolution = resolveDocPath(doc);
  if (!resolution.ok) return { ok: false, error: resolution.error };
  const target = resolution.path;
  if (isSysdfPath(target)) return { ok: true, doc: target, system: null };
  const kept = preferred ? listing(preferred, target) : null;
  if (kept) return { ok: true, doc: target, system: kept };

  let dir = dirname(target);
  for (let depth = 0; depth <= SEARCH_DEPTH && underAnAdmittedRoot(dir); depth += 1) {
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((f) => !f.startsWith(".") && isSysdfPath(f)).sort();
    } catch {
      // An unreadable folder lists nothing.
    }
    for (const name of names) {
      const system = listing(join(dir, name), target);
      if (system) return { ok: true, doc: target, system };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { ok: true, doc: target, system: null };
}
