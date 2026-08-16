#!/usr/bin/env node
/**
 * stateloom-supervise — the whole loom in one container.
 *
 * `docker compose` is the right shape for a machine somebody administers. It is
 * the wrong shape for the first thirty seconds of an agent's life, where the
 * ask is "give me a board my human can open". So the default role of the image
 * is `all`: hub, canvas, MCP and gateway as four children of one process,
 * behind one published port.
 *
 * What a shell script cannot do here, and why this is Node:
 *   - busybox `ash` has no reliable `wait -n`, so "exit when ANY child dies"
 *     degrades into "hang until the last one does" — a container that looks
 *     healthy with a dead canvas inside it.
 *   - signals must reach four children and the exit code of the FIRST one to
 *     die must become the container's, or `docker compose up` reports success
 *     over a crash.
 *
 * Children are never restarted. A crash loop hidden inside a container is worse
 * than a container that stops: the orchestrator above (compose `restart:`,
 * systemd, k8s) is the layer that owns restart policy, and it can only own it
 * if this process is honest about dying.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;

const HUB_PORT = env.STATELOOM_BRIDGE_PORT ?? '4599';
const WEB_PORT = env.STATELOOM_WEB_PORT ?? '4598';
const MCP_PORT = env.STATELOOM_MCP_HTTP_PORT ?? '4600';
const GATEWAY_PORT = env.STATELOOM_GATEWAY_PORT ?? '8080';
const DOC = env.STATELOOM_PROJECT_FILE ?? '/data/statemachine.smdf.json';
const WITH_MCP = !/^(0|false|no)$/i.test(env.STATELOOM_WITH_MCP ?? '1');

/**
 * The canvas is told its bridge is `/` — same origin as the page. Everything
 * about a containerised loom that used to need the operator to know the
 * browser's view of the network collapses into that one character.
 */
const children = [];

function start(name, command, args, extra = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...env, ...extra },
  });
  child.on('error', (err) => {
    console.error(`[supervise] ${name} failed to start: ${err.message}`);
    shutdown(127, name);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[supervise] ${name} exited (${signal ?? `code ${code}`}) — bringing the loom down`);
    shutdown(signal ? 128 : (code ?? 1), name);
  });
  children.push({ name, child });
  return child;
}

let stopping = false;
function shutdown(code, blame) {
  if (stopping) return;
  stopping = true;
  for (const { name, child } of children) {
    if (name === blame) continue;
    child.kill('SIGTERM');
  }
  // Children get a grace period; anything still alive after it is not going to
  // exit on its own and would hold the container open indefinitely.
  const grace = setTimeout(() => {
    for (const { child } of children) child.kill('SIGKILL');
    process.exit(code);
  }, 5000);
  grace.unref();

  let left = children.filter((c) => c.name !== blame).length;
  if (left === 0) process.exit(code);
  for (const { name, child } of children) {
    if (name === blame) continue;
    child.on('exit', () => {
      if (--left === 0) process.exit(code);
    });
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`[supervise] ${signal} — stopping the loom`);
    shutdown(0, null);
  });
}

console.error(
  `[supervise] one loom, one port\n` +
    `  document : ${DOC}\n` +
    `  gateway  : :${GATEWAY_PORT}  → canvas :${WEB_PORT}, hub :${HUB_PORT}` +
    (WITH_MCP ? `, mcp :${MCP_PORT}` : ' (mcp off)'),
);

// Hub first: the canvas and the MCP both dial it, and both retry, but starting
// in dependency order keeps the first ten seconds of logs readable.
start('hub', 'smcraft-bridge', ['--port', HUB_PORT, '--host', '127.0.0.1', '--doc', DOC]);

if (WITH_MCP) {
  start('mcp', 'stateloom-mcp', [], {
    STATELOOM_MCP_HTTP_PORT: MCP_PORT,
    STATELOOM_MCP_HTTP_HOST: '127.0.0.1',
    STATELOOM_PROJECT_FILE: DOC,
    STATELOOM_BRIDGE_URL: `http://127.0.0.1:${HUB_PORT}`,
  });
}

start('canvas', 'stateloom-web', ['--port', WEB_PORT, '--host', '127.0.0.1', '--doc', DOC], {
  // Same origin. Not a hostname, not an IP, not a port — the browser resolves
  // it against whatever address the human actually typed.
  STATELOOM_BRIDGE_URL: '/',
  SMCRAFT_BRIDGE_URL: '/',
});

start('gateway', process.execPath, [resolve(HERE, 'gateway.mjs')], {
  STATELOOM_GATEWAY_PORT: GATEWAY_PORT,
  STATELOOM_GATEWAY_HOST: '0.0.0.0',
  STATELOOM_GATEWAY_CANVAS: `127.0.0.1:${WEB_PORT}`,
  STATELOOM_GATEWAY_HUB: `127.0.0.1:${HUB_PORT}`,
  ...(WITH_MCP ? { STATELOOM_GATEWAY_MCP: `127.0.0.1:${MCP_PORT}` } : {}),
});
