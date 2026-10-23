/**
 * install.ts — copy a skill out of the bundled pack and into a consumer's tree.
 *
 * Installing is a directory copy and nothing more. The destination default,
 * `.claude/skills/<name>/`, is where Claude Code looks; other agent runtimes
 * take `--dir`.
 *
 * The one rule worth stating: an existing directory is never silently
 * overwritten. A consumer who edited a skill in place has done real work, and
 * a second `install` a month later must not eat it. `--force` is the way to say
 * "yes, replace mine", and it removes the old directory first so a renamed or
 * deleted reference file cannot survive as a ghost beside the new one.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { findSkill, type Skill } from "./catalog.js";

export interface InstallOpts {
  /** Directory that will hold `<name>/`. Defaults to `.claude/skills`. */
  dir?: string;
  /** Replace an existing installation instead of refusing. */
  force?: boolean;
  /** Report what would happen and write nothing. */
  dryRun?: boolean;
  /** Root of the bundled pack; the tests point this at a fixture. */
  root?: string;
}

export type InstallStatus = "installed" | "replaced" | "exists" | "missing";

export interface InstallResult {
  name: string;
  status: InstallStatus;
  /** Absolute destination path, or `undefined` when the skill was not found. */
  target?: string;
  /** File count copied, for the caller's report. */
  files?: number;
}

/** Where skills land when the caller names no directory. */
export function defaultTargetDir(cwd = process.cwd()): string {
  const fromEnv = process.env.STATELOOM_SKILLS_DIR;
  return fromEnv ? resolve(fromEnv) : resolve(cwd, ".claude", "skills");
}

/** Install one skill by name. Never throws on a missing skill — it reports it. */
export function installSkill(name: string, opts: InstallOpts = {}): InstallResult {
  const skill: Skill | undefined = findSkill(name, opts.root);
  if (!skill) return { name, status: "missing" };

  const base = opts.dir ? resolve(opts.dir) : defaultTargetDir();
  const target = join(base, skill.name);
  const already = existsSync(target);

  if (already && !opts.force) return { name, status: "exists", target, files: skill.files.length };

  const status: InstallStatus = already ? "replaced" : "installed";
  if (opts.dryRun) return { name, status, target, files: skill.files.length };

  if (already) rmSync(target, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  cpSync(skill.dir, target, { recursive: true });

  return { name, status, target, files: skill.files.length };
}

/** Install several skills, preserving the order asked for. */
export function installSkills(names: string[], opts: InstallOpts = {}): InstallResult[] {
  return names.map((name) => installSkill(name, opts));
}
