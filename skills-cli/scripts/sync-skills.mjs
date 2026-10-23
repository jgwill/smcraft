#!/usr/bin/env node
/**
 * sync-skills.mjs — copy the canonical skill pack into the publishable package.
 *
 * The skills are authored once, at the repo root, in `skills/`. They are the
 * repo's own documentation as much as they are a shipped artifact, so that is
 * where a reader browsing GitHub finds them. But npm publishes a directory,
 * not a repo: a `files` entry cannot reach outside the package folder and a
 * symlink is dereferenced inconsistently across npm versions and filesystems.
 *
 * So the pack is mirrored into `skills-cli/skills/` — a build output, gitignored
 * exactly like `dist/`, refreshed by `build` and again by `prepack` so a publish
 * can never ship a stale copy of a skill that was edited after the last build.
 *
 * Deliberately dependency-free: it runs during `npm pack`/`npm publish`, when
 * assuming anything about installed devDependencies is a way to break a release.
 *
 * Every line it prints goes to stderr, including the successful ones. As a
 * `prepack` hook it runs inside `npm pack --dry-run --json`, and stdout there
 * belongs to npm's JSON — one friendly progress line on the wrong stream and
 * the release tooling parsing that output fails on `Unexpected token 's'`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const SOURCE = process.env.STATELOOM_SKILLS_SOURCE
  ? resolve(process.env.STATELOOM_SKILLS_SOURCE)
  : resolve(PKG, '..', 'skills');
const TARGET = join(PKG, 'skills');

if (!existsSync(SOURCE)) {
  // A consumer installing from the registry has the mirror already and no
  // source to mirror from; `prepack` never runs there, but a stray invocation
  // must not fail the install.
  if (existsSync(TARGET)) {
    console.error(`sync-skills: no source at ${SOURCE}; keeping the bundled pack`);
    process.exit(0);
  }
  console.error(`sync-skills: no skill pack at ${SOURCE}`);
  process.exit(1);
}

rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });
cpSync(SOURCE, TARGET, { recursive: true });

/** Every directory holding a SKILL.md is one installable skill. */
const skills = readdirSync(TARGET)
  .filter((name) => statSync(join(TARGET, name)).isDirectory())
  .filter((name) => existsSync(join(TARGET, name, 'SKILL.md')))
  .sort();

if (skills.length === 0) {
  console.error(`sync-skills: mirrored ${SOURCE} but found no <name>/SKILL.md inside it`);
  process.exit(1);
}

console.error(`sync-skills: ${skills.length} skills mirrored → skills/`);
for (const name of skills) console.error(`  ${name}`);
