#!/usr/bin/env node
/**
 * stateloom-web — serve the visual designer.
 *
 * A thin launcher over the prebuilt Next.js standalone server. Its whole job is
 * to resolve the three things that must agree across every process in the loop
 * and hand them over as environment, because the failure they cause is silent:
 * a canvas showing `○ no disk` while an agent happily writes somewhere else.
 *
 *   STATELOOM_PROJECT_FILE  the document — resolved to an ABSOLUTE path here,
 *                           since the server resolves relative paths against
 *                           its own cwd and the agent resolves against theirs
 *   STATELOOM_BRIDGE_URL    the hub; the browser now asks /api/config for this
 *                           at runtime, so a published build carries nobody's
 *   STATELOOM_WEB_PORT      4598, the canvas half of the loom's pair with 4599
 *
 * Both the STATELOOM_* name and its legacy SMCRAFT_* twin are exported, so a
 * process of either generation reads the same values.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..', 'server', 'server.js');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
};
const has = (...names) => names.some((n) => argv.includes(n));

if (has('--help', '-h')) {
  console.log(`stateloom-web — the stateloom visual state machine designer

Usage
  stateloom-web [options]

Options
  --doc <path>      the .smdf.json document to open (made absolute)
  --bridge <url>    bridge hub URL, e.g. http://127.0.0.1:4599
  --port <n>        port to serve on (default 4598)
  --host <host>     interface to bind (default 0.0.0.0; STATELOOM_WEB_HOST)
  --version         print versions and exit

Environment (flags win; the legacy SMCRAFT_* twin of each is honored)
  STATELOOM_PROJECT_FILE   the document
  STATELOOM_BRIDGE_URL     the hub
  STATELOOM_WEB_PORT       the port

Examples
  export STATELOOM_PROJECT_FILE=/abs/path/machine.smdf.json
  npx -y @miadi/stateloom @miadi/stateloom-cli   # then: smcx serve --port 4599
  npx -y @miadi/stateloom-web --bridge http://127.0.0.1:4599

4598 (canvas) and 4599 (hub) are the loom's pair.`);
  process.exit(0);
}

const alias = (suffix) => process.env[`STATELOOM_${suffix}`] ?? process.env[`SMCRAFT_${suffix}`];

if (has('--version', '-v')) {
  const meta = resolve(HERE, '..', 'server', 'stateloom-web.json');
  console.log(existsSync(meta) ? readFileSync(meta, 'utf8').trim() : 'unknown');
  process.exit(0);
}

if (!existsSync(SERVER)) {
  console.error(
    `stateloom-web: the bundled server is missing (${SERVER}).\n` +
      `This package ships a prebuilt designer; a broken install is the only way to see this.`
  );
  process.exit(1);
}

// Absolute, always. A relative document path is the one configuration mistake
// that produces no error anywhere — just two processes quietly disagreeing.
const doc = resolve(flag('--doc') ?? alias('PROJECT_FILE') ?? './statemachine.smdf.json');
const bridge = flag('--bridge') ?? alias('BRIDGE_URL');
const port = flag('--port') ?? alias('WEB_PORT') ?? '4598';
// NOT process.env.HOSTNAME: in a login shell that is the machine's name, and
// Next reads HOSTNAME as a bind address — so inheriting it silently binds the
// server to something like 127.0.1.1 and every localhost request hangs.
const host = flag('--host') ?? alias('WEB_HOST') ?? '0.0.0.0';

const env = {
  ...process.env,
  STATELOOM_PROJECT_FILE: doc,
  SMCRAFT_PROJECT_FILE: doc,
  STATELOOM_WEB_PORT: port,
  PORT: port,
  HOSTNAME: host,
};
if (bridge) {
  env.STATELOOM_BRIDGE_URL = bridge;
  env.SMCRAFT_BRIDGE_URL = bridge;
}

console.error(`stateloom-web → http://localhost:${port}`);
console.error(`  document: ${doc}${existsSync(doc) ? '' : '  (does not exist yet — the designer will create it)'}`);
console.error(
  bridge
    ? `  bridge:   ${bridge}`
    : `  bridge:   none — edits save to disk, but no live agent or terminal will see them.\n` +
        `            Start one with \`smcx serve --port 4599\` and pass --bridge http://127.0.0.1:4599.`
);

const child = spawn(process.execPath, [SERVER], { env, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
