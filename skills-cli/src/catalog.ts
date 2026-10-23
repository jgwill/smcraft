/**
 * catalog.ts — read the bundled skill pack off disk.
 *
 * A skill is a directory holding a `SKILL.md` whose YAML frontmatter carries
 * `name` and `description`. That is the whole contract, and it is the same
 * contract Claude Code reads from `.claude/skills/`, which is why installing is
 * a plain directory copy rather than a transform: what ships is already what
 * the agent loads.
 *
 * The frontmatter reader here is deliberately tiny — two flat scalar keys, no
 * nesting, no anchors. Pulling in a YAML parser to read two lines would put a
 * dependency between an agent and `npx @miadi/stateloom-skills`, and the point
 * of this package is that there is nothing between them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Skill {
  /** Directory name, which the frontmatter `name` must match. */
  name: string;
  /** One-line summary an agent reads to decide whether to load the skill. */
  description: string;
  /** Absolute path to the skill's directory inside this package. */
  dir: string;
  /** Every file in the skill, relative to `dir`, sorted. */
  files: string[];
}

/**
 * The bundled pack lives beside `dist/` at the package root. `STATELOOM_SKILLS_SOURCE`
 * redirects it, which is how the tests run against a fixture and how someone
 * working in the repo can point at `skills/` before a build has mirrored it.
 */
export function skillsRoot(): string {
  const override = process.env.STATELOOM_SKILLS_SOURCE;
  if (override) return resolve(override);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "skills");
}

/** Parse `name:` and `description:` out of a leading `---` frontmatter block. */
export function parseFrontmatter(source: string): Record<string, string> {
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};

  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") break;
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    // Strip one layer of matching quotes; a description often contains commas
    // and colons, so authors quote it.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** List every file under `dir`, relative to it, depth-first and sorted. */
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/** Every installable skill in the pack, sorted by name. */
export function loadCatalog(root = skillsRoot()): Skill[] {
  if (!existsSync(root)) return [];

  const skills: Skill[] = [];
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const manifest = join(dir, "SKILL.md");
    if (!existsSync(manifest)) continue;

    const front = parseFrontmatter(readFileSync(manifest, "utf8"));
    skills.push({
      name,
      description: front.description ?? "",
      dir,
      files: walk(dir),
    });
  }
  return skills;
}

/** One skill by name, or `undefined` when the pack has no such directory. */
export function findSkill(name: string, root = skillsRoot()): Skill | undefined {
  return loadCatalog(root).find((s) => s.name === name);
}
