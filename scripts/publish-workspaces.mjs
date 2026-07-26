#!/usr/bin/env node

/**
 * publish-workspaces.mjs — publish smcraft's flat multi-package repo to npm.
 *
 * smcraft is NOT an npm workspace. There is no root package.json; each package
 * is an independent project in a sibling directory with its own lockfile and
 * its own version line (`smcraft` is on 0.4.x while every `@miadi/stateloom-*` is on
 * 0.1.x). Everything npm normally does for a workspace — ordering, dependency
 * resolution, `--workspace` publishing — has to be done here explicitly.
 *
 * The one thing this script exists for:
 *
 *   Intra-repo dependencies are declared as `file:../<dir>` so a plain
 *   `npm ci` in any package dir links the sibling source tree. A `file:`
 *   specifier is meaningless once installed from the registry — npm publishes
 *   it verbatim and every consumer breaks. So at pack/publish time each
 *   `file:` specifier is rewritten to a real range read from the sibling's
 *   package.json (`file:../bridge-protocol` → `^0.1.0`), the package is
 *   packed or published, and the manifest is restored byte-for-byte in a
 *   `finally` — including on throw, on a failed publish, and on SIGINT.
 *
 * Modes
 *   (default)     npm publish --access public, skipping versions already on npm
 *   --dry-run     npm publish --access public --dry-run (or DRY_RUN=1)
 *   --pack-check  npm pack --dry-run --json, then assert the tarball actually
 *                 contains the files main/types/bin point at, and that no
 *                 `file:` specifier survived. Local only — no registry, no
 *                 credentials — so CI can prove the manifests are publishable
 *                 before a human is asked to approve anything.
 *
 * Flags / env
 *   --only a,b        restrict to these package directories (retry a failure)
 *   RANGE_STYLE       caret (default) | exact — how a rewritten dep is pinned
 *   SMCRAFT_ROOT      repo root (default: the parent of this script's dir)
 *   SMCRAFT_NPM       npm executable (default: npm) — used by the offline test
 *
 * This script does NOT build. dist/ is gitignored, so the caller must have
 * built every package in dependency order first; publish mode refuses to
 * publish a package whose `main` does not exist on disk.
 *
 * Requires Node >= 20. No dependencies.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// TOPOLOGICAL ORDER — do not alphabetize, do not reorder.
//
// This array is both the build order and the publish order. `bridge-client`
// after `bridge-protocol` because it imports it; `cli` after `bridge`;
// `mcp` last. Publishing a package before something it depends on would put a
// permanent version on npm whose dependency range points at a version that
// does not exist yet.
//
// `web` is deliberately absent: it is `"private": true` and must never be
// published.
// ─────────────────────────────────────────────────────────────────────────────
const PACKAGES = [
	'ts', // smcraft — no intra-repo deps, the root of the graph
	'bridge-protocol',
	'bridge-client',
	'bridge',
	'bridge-react',
	'cli',
	'mcp',
];

const ROOT = resolve(
	process.env.SMCRAFT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const NPM = process.env.SMCRAFT_NPM || 'npm';
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const argv = process.argv.slice(2);
const packCheck = argv.includes('--pack-check');
const dryRun = argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const rangeStyle = process.env.RANGE_STYLE === 'exact' ? 'exact' : 'caret';

if (argv.includes('--help') || argv.includes('-h')) {
	console.log(
		'Usage: node scripts/publish-workspaces.mjs [--dry-run|--pack-check] [--only dir,dir]',
	);
	process.exit(0);
}

const onlyFlag = argv.indexOf('--only');
const only =
	onlyFlag !== -1 && argv[onlyFlag + 1]
		? new Set(argv[onlyFlag + 1].split(',').map((s) => s.trim()).filter(Boolean))
		: null;

if (only) {
	for (const dir of only) {
		if (!PACKAGES.includes(dir)) {
			console.error(`--only names an unknown package directory: ${dir}`);
			console.error(`known: ${PACKAGES.join(', ')}`);
			process.exit(1);
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Load every manifest, always — even the ones --only excludes. A filtered run
// still has to read the excluded packages' versions to rewrite the specifiers
// that point at them.
// ─────────────────────────────────────────────────────────────────────────────
const manifests = new Map(); // dir -> { dir, path, raw, data }
const versionByName = new Map(); // package name -> version
const dirByName = new Map();

for (const dir of PACKAGES) {
	const path = join(ROOT, dir, 'package.json');
	if (!existsSync(path)) {
		console.error(`Missing manifest: ${path}`);
		process.exit(1);
	}
	const raw = readFileSync(path, 'utf8');
	const data = JSON.parse(raw);
	manifests.set(dir, { dir, path, raw, data });
	versionByName.set(data.name, data.version);
	dirByName.set(data.name, dir);
}

/** Rewrite every `file:` specifier to a registry range. Returns the new text. */
function rewriteManifest(entry) {
	const next = JSON.parse(entry.raw);
	const changes = [];

	for (const section of DEP_SECTIONS) {
		const deps = next[section];
		if (!deps) continue;

		for (const [depName, spec] of Object.entries(deps)) {
			const isIntra = versionByName.has(depName);

			if (typeof spec === 'string' && spec.startsWith('file:')) {
				// A `file:` pointing outside the known package set cannot be
				// turned into a range — publishing it would ship a broken
				// manifest, so stop rather than guess.
				if (!isIntra) {
					throw new Error(
						`${entry.data.name}: ${section}.${depName} is "${spec}" but ${depName} is not one of this repo's packages — cannot rewrite it to a version range.`,
					);
				}
				const version = versionByName.get(depName);
				const range = rangeStyle === 'exact' ? version : `^${version}`;
				deps[depName] = range;
				changes.push(`${section}.${depName}: ${spec} → ${range}`);
				continue;
			}

			// An intra-repo dep already written as a range: leave it, but say
			// so when it no longer matches the sibling on disk. Silent drift
			// here is how a package ships depending on a version nobody built.
			if (isIntra && typeof spec === 'string') {
				const expected = `^${versionByName.get(depName)}`;
				if (spec !== expected && spec !== versionByName.get(depName)) {
					console.warn(
						`  ⚠ ${entry.data.name}: ${section}.${depName} is "${spec}" but the sibling is at ${versionByName.get(depName)}`,
					);
				}
			}
		}
	}

	// Belt and braces: nothing local may survive into a published manifest.
	for (const section of DEP_SECTIONS) {
		for (const [depName, spec] of Object.entries(next[section] || {})) {
			if (typeof spec === 'string' && /^(file:|link:|portal:)/.test(spec)) {
				throw new Error(
					`${entry.data.name}: ${section}.${depName} is still "${spec}" after rewrite.`,
				);
			}
		}
	}

	return { text: JSON.stringify(next, null, 2) + '\n', changes };
}

/** Restore the manifest exactly as it was on disk before this run touched it. */
function restore(entry) {
	if (readFileSync(entry.path, 'utf8') !== entry.raw) {
		writeFileSync(entry.path, entry.raw);
	}
}

const touched = new Set();
function restoreAll() {
	for (const entry of touched) {
		try {
			restore(entry);
		} catch (err) {
			console.error(`FAILED TO RESTORE ${entry.path}: ${err.message}`);
			console.error(`Recover with: git checkout -- ${entry.path}`);
		}
	}
	touched.clear();
}

// An interrupted run must not leave a rewritten manifest behind — the next
// `npm ci` would try to install `@miadi/stateloom-protocol@^0.1.0` from the
// registry instead of linking the sibling directory.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
	process.on(signal, () => {
		restoreAll();
		process.exit(130);
	});
}
process.on('uncaughtException', (err) => {
	restoreAll();
	console.error(err);
	process.exit(1);
});

function run(args, cwd, capture = false) {
	return execFileSync(NPM, args, {
		cwd,
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
	});
}

/** `npm view <name>@<version>` — non-zero exit means "not on the registry". */
function alreadyPublished(name, version) {
	try {
		execFileSync(NPM, ['view', `${name}@${version}`, 'version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** Paths a consumer will require the moment they install this package. */
function entryPoints(pkg) {
	const paths = new Set();
	const add = (p) => {
		if (typeof p === 'string') paths.add(p.replace(/^\.\//, ''));
	};
	add(pkg.main);
	add(pkg.types);
	if (typeof pkg.bin === 'string') add(pkg.bin);
	else for (const p of Object.values(pkg.bin || {})) add(p);
	for (const target of Object.values(pkg.exports || {})) {
		if (typeof target === 'string') add(target);
		else for (const p of Object.values(target || {})) add(p);
	}
	return [...paths];
}

/**
 * The defect this catches: every package here declares `files: ["dist/**\/*.js",
 * "dist/**\/*.d.ts"]` over a gitignored dist/, and `mcp` declares no `files` at
 * all. A wrong glob, an unbuilt dist, or a stray ignore file produces a tarball
 * that installs cleanly and then cannot be imported — and the version is
 * permanent. So: pack it, and assert the entry points are actually inside.
 */
function packCheckOne(entry) {
	const out = run(['pack', '--dry-run', '--json'], join(ROOT, entry.dir), true);
	const [info] = JSON.parse(out);
	const packed = new Set((info.files || []).map((f) => f.path));
	const missing = entryPoints(entry.data).filter((p) => !packed.has(p));

	if (!packed.has('package.json')) missing.push('package.json');
	if (missing.length) {
		throw new Error(
			`tarball is missing ${missing.join(', ')} — the \`files\` glob resolved to nothing useful (entryCount=${info.entryCount}). Build dist/ first, or fix \`files\`.`,
		);
	}
	for (const p of packed) {
		if (p.startsWith('node_modules/')) throw new Error(`tarball contains ${p}`);
	}
	return `${info.entryCount} files, ${Math.round((info.unpackedSize || 0) / 1024)} KiB unpacked`;
}

function publishOne(entry) {
	const { name, version } = entry.data;

	// A package whose main does not exist was never built. Refuse — this
	// version can never be taken back.
	const main = (entry.data.main || '').replace(/^\.\//, '');
	if (main && !existsSync(join(ROOT, entry.dir, main))) {
		throw new Error(`${main} does not exist — build ${entry.dir} before publishing.`);
	}

	// Idempotent: a re-run after a partial failure must not fail on the
	// packages that already made it out. `npm publish --dry-run` also errors
	// on an existing version, so the skip applies to both modes.
	if (alreadyPublished(name, version)) return { status: 'skipped', detail: 'already on npm' };

	const args = ['publish', '--access', 'public'];
	if (dryRun) args.push('--dry-run');
	run(args, join(ROOT, entry.dir));
	return { status: dryRun ? 'dry-run' : 'published', detail: `${name}@${version}` };
}

// ─────────────────────────────────────────────────────────────────────────────
const targets = PACKAGES.filter((dir) => !only || only.has(dir));
const mode = packCheck ? 'pack-check' : dryRun ? 'registry dry-run' : 'PUBLISH';
console.log(`smcraft ${mode} — ${targets.length} package(s), ${rangeStyle} ranges\n`);

const results = [];
let failed = null;

for (const dir of targets) {
	const entry = manifests.get(dir);
	const { name, version } = entry.data;
	console.log(`── ${dir} (${name}@${version})`);

	try {
		const { text, changes } = rewriteManifest(entry);
		if (changes.length) {
			touched.add(entry);
			writeFileSync(entry.path, text);
			for (const c of changes) console.log(`   rewrote ${c}`);
		} else {
			console.log('   no file: specifiers');
		}

		try {
			const outcome = packCheck
				? { status: 'packed', detail: packCheckOne(entry) }
				: publishOne(entry);
			results.push({ dir, name, version, ...outcome });
			console.log(`   ${outcome.status}: ${outcome.detail}`);
		} finally {
			// Always, on every path: the working tree goes back to `file:`
			// specifiers so the next `npm ci` links siblings again.
			restore(entry);
			touched.delete(entry);
		}
	} catch (err) {
		results.push({ dir, name, version, status: 'FAILED', detail: err.message.split('\n')[0] });
		failed = { dir, err };
		// Fail fast. Continuing would publish a dependent whose rewritten range
		// points at a version that just failed to reach the registry.
		console.error(`   FAILED: ${err.message}`);
		break;
	}
}

restoreAll();

const skipped = targets.slice(results.length).map((dir) => ({
	dir,
	name: manifests.get(dir).data.name,
	version: manifests.get(dir).data.version,
	status: 'not attempted',
	detail: failed ? `aborted after ${failed.dir}` : '',
}));

const rows = [...results, ...skipped];
const w = (key, min) => Math.max(min, ...rows.map((r) => String(r[key]).length));
const [wn, wv, ws] = [w('name', 7), w('version', 7), w('status', 6)];

console.log(`\n${'package'.padEnd(wn)}  ${'version'.padEnd(wv)}  ${'result'.padEnd(ws)}  detail`);
console.log(`${'-'.repeat(wn)}  ${'-'.repeat(wv)}  ${'-'.repeat(ws)}  ------`);
for (const r of rows) {
	console.log(
		`${r.name.padEnd(wn)}  ${r.version.padEnd(wv)}  ${r.status.padEnd(ws)}  ${r.detail}`,
	);
}

if (failed) {
	console.error(
		`\n${mode} failed at ${failed.dir}. Manifests restored. Retry the rest with: --only ${targets.slice(targets.indexOf(failed.dir)).join(',')}`,
	);
	process.exit(1);
}
console.log(`\n${mode} complete.`);
