#!/usr/bin/env node
/**
 * sync-engine.mjs — mirror the built engine into the scoped package.
 *
 * `smcraft` and `@miadi/stateloom-engine` are two names for one thing. The
 * engine has been on npm as `smcraft` since 0.1.0, generated code emits
 * `import … from "smcraft/runtime"`, and the PyPI twin carries the same name —
 * so that name cannot move. But every other piece of this system now lives
 * under `@miadi/stateloom*`, and an engine outside the namespace is a hole in
 * the set.
 *
 * Rather than an alias package that re-exports — one more hop, one more thing
 * that can drift a version — both names publish byte-identical `dist/`. This
 * copies `../ts/dist` in on `build` and again on `prepack`, so the scoped
 * package can never ship an older engine than the unscoped one.
 *
 * Same pattern as `skills-cli/scripts/sync-skills.mjs`, including the rule
 * that every line prints to **stderr**: as a `prepack` hook this runs inside
 * `npm pack --dry-run --json`, where stdout belongs to npm's JSON.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const SOURCE = resolve(PKG, '..', 'ts', 'dist');
const TARGET = join(PKG, 'dist');

if (!existsSync(SOURCE)) {
  if (existsSync(TARGET)) {
    console.error(`sync-engine: no source at ${SOURCE}; keeping the bundled dist`);
    process.exit(0);
  }
  console.error(`sync-engine: no build at ${SOURCE} — run \`npm run build\` in ts/ first`);
  process.exit(1);
}

// The two manifests must agree on version, or `smcraft@x` and
// `@miadi/stateloom-engine@x` stop meaning the same code — which is the one
// promise this arrangement makes.
const ours = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const theirs = JSON.parse(readFileSync(resolve(PKG, '..', 'ts', 'package.json'), 'utf8'));
if (ours.version !== theirs.version) {
  console.error(
    `sync-engine: version drift — ${ours.name}@${ours.version} vs ${theirs.name}@${theirs.version}.\n` +
      `Both names publish the same dist and must carry the same version.`
  );
  process.exit(1);
}

rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });
cpSync(SOURCE, TARGET, { recursive: true });

console.error(`sync-engine: ts/dist → engine/dist at ${ours.version}`);
