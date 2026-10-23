#!/usr/bin/env node
/**
 * sync-docker.mjs — mirror the repository's docker assets into this package.
 *
 * `stateloom docker up` runs a compose project. That compose file must be the
 * SAME one that lives at the root of the smcraft repository, because both are
 * read by people who assume they describe the same system — an agent running it
 * through npx, and a contributor reading it on GitHub. Two copies maintained by
 * hand is a drift waiting to be discovered by somebody debugging at midnight.
 *
 * So the root file is canonical and this mirrors it in at build and prepack
 * time, exactly like sync-skills.mjs does for the skill pack. `docker/` here is
 * a build output and is gitignored.
 *
 * Everything prints to stderr: as a `prepack` hook this runs inside
 * `npm pack --dry-run --json`, where stdout belongs to npm.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const ROOT = resolve(PKG, '..');
const TARGET = join(PKG, 'docker');

const ASSETS = [
  ['docker-compose.yml', 'docker-compose.yml'],
  ['.env.docker.example', 'env.example'],
];

const missing = ASSETS.filter(([from]) => !existsSync(join(ROOT, from)));
if (missing.length) {
  // Installed from the registry the mirror is already here and there is no
  // source to mirror from; `prepack` never runs there, but a stray invocation
  // must not fail an install.
  if (existsSync(join(TARGET, 'docker-compose.yml'))) {
    console.error('sync-docker: no source at the repo root; keeping the bundled assets');
    process.exit(0);
  }
  console.error(`sync-docker: missing at ${ROOT}: ${missing.map(([f]) => f).join(', ')}`);
  process.exit(1);
}

mkdirSync(TARGET, { recursive: true });
for (const [from, to] of ASSETS) {
  copyFileSync(join(ROOT, from), join(TARGET, to));
  console.error(`sync-docker: ${from} → docker/${to}`);
}
