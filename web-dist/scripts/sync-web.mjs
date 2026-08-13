#!/usr/bin/env node
/**
 * sync-web.mjs — assemble the publishable designer from the Next.js build.
 *
 * `next build` with `output: "standalone"` writes three pieces that only work
 * together, and does NOT put them together:
 *
 *   .next/standalone/web/       server.js + the node_modules it actually reaches
 *   .next/static/               the client bundle, which standalone omits
 *   public/                     static assets, likewise omitted
 *
 * Next's own docs say to copy the last two in by hand after building. This does
 * that, into `server/`, so the published package is one directory a plain
 * `node server/server.js` can run — no repo, no Next.js toolchain, no build
 * step on the consumer's machine.
 *
 * Every line prints to stderr: as a `prepack` hook this runs inside
 * `npm pack --dry-run --json`, where stdout belongs to npm's JSON.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const WEB = resolve(PKG, '..', 'web');
const NEXT = join(WEB, '.next');
const STANDALONE = join(NEXT, 'standalone', 'web');
const TARGET = join(PKG, 'server');

if (!existsSync(STANDALONE)) {
  if (existsSync(TARGET)) {
    console.error(`sync-web: no build at ${STANDALONE}; keeping the bundled server`);
    process.exit(0);
  }
  console.error(
    `sync-web: no standalone build at ${STANDALONE}\n` +
      `  run \`npm run build\` in web/ first (needs output: "standalone" in next.config.ts)`
  );
  process.exit(1);
}

rmSync(TARGET, { recursive: true, force: true });
mkdirSync(TARGET, { recursive: true });
cpSync(STANDALONE, TARGET, { recursive: true });

// The two directories standalone deliberately leaves behind. Without .next/static
// the page loads and every script 404s — a blank canvas with no error, which is
// the failure this copy exists to prevent.
cpSync(join(NEXT, 'static'), join(TARGET, '.next', 'static'), { recursive: true });
if (existsSync(join(WEB, 'public'))) {
  cpSync(join(WEB, 'public'), join(TARGET, 'public'), { recursive: true });
}

if (!existsSync(join(TARGET, 'server.js'))) {
  console.error('sync-web: copied the build but found no server.js in it');
  process.exit(1);
}

// Record which designer version this is, so `stateloom-web --version` answers
// from the build rather than from a constant somebody forgot to bump.
const web = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'));
const self = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
writeFileSync(
  join(TARGET, 'stateloom-web.json'),
  JSON.stringify({ package: self.version, designer: web.version, next: web.dependencies?.next }, null, 2) + '\n'
);

console.error(`sync-web: designer ${web.version} → server/ (package ${self.version})`);
