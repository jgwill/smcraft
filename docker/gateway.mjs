#!/usr/bin/env node
/**
 * stateloom-gateway — put the whole loom behind ONE port.
 *
 * The loom is three servers that a browser and an agent both have to reach:
 *
 *     /socket.io/*   → the hub    (websocket; the canvas's live channel)
 *     /mcp           → the MCP    (the agent's channel; bearer-token guarded)
 *     everything else → the canvas (the Next.js designer)
 *
 * Without this, a containerised loom publishes two or three host ports AND the
 * operator must hand the *browser* a hub URL that is correct from the browser's
 * point of view — not the container's. That is the single failure this file
 * exists to delete: `STATELOOM_BRIDGE_URL=http://hub:4599` resolves inside the
 * compose network and nowhere else, so the canvas renders, the socket never
 * connects, and the board just sits there looking fine.
 *
 * With the gateway the canvas is told the bridge is `/` — same origin, whatever
 * origin that turns out to be. localhost, a LAN address, a tailnet name, a
 * reverse proxy with TLS in front: all correct without configuration, because
 * the browser resolves it against the page it is already on.
 *
 * No dependencies, deliberately. This runs as PID-adjacent infrastructure in a
 * container that must come up when a registry is unreachable.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';

const PORT = Number(process.env.STATELOOM_GATEWAY_PORT ?? 8080);
const HOST = process.env.STATELOOM_GATEWAY_HOST ?? '0.0.0.0';

/** Upstreams as host:port pairs — inside the container, or across a compose network. */
const UP = {
  canvas: split(process.env.STATELOOM_GATEWAY_CANVAS ?? '127.0.0.1:4598'),
  hub: split(process.env.STATELOOM_GATEWAY_HUB ?? '127.0.0.1:4599'),
  mcp: process.env.STATELOOM_GATEWAY_MCP ? split(process.env.STATELOOM_GATEWAY_MCP) : null,
};

function split(hostport) {
  const at = hostport.lastIndexOf(':');
  if (at === -1) throw new Error(`not a host:port — ${hostport}`);
  return { host: hostport.slice(0, at), port: Number(hostport.slice(at + 1)) };
}

/**
 * Which upstream serves this path.
 *
 * `/socket.io` is matched as a path SEGMENT, not a prefix: `/socket.iowhatever`
 * is a canvas route and must not be handed to the hub.
 */
function route(pathname) {
  if (pathname === '/socket.io' || pathname.startsWith('/socket.io/')) return 'hub';
  if (UP.mcp && (pathname === '/mcp' || pathname.startsWith('/mcp/'))) return 'mcp';
  return 'canvas';
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Is an upstream accepting connections right now? Used only by /healthz. */
function reachable({ host, port }, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

const server = createServer((req, res) => {
  const pathname = (req.url ?? '/').split('?')[0];

  // The gateway's own liveness, distinct from any upstream's. Named /healthz so
  // it cannot collide with the MCP server's /health, which is proxied.
  if (pathname === '/healthz') {
    Promise.all([
      reachable(UP.canvas),
      reachable(UP.hub),
      UP.mcp ? reachable(UP.mcp) : Promise.resolve(null),
    ]).then(([canvas, hub, mcp]) => {
      const parts = { canvas, hub, ...(mcp === null ? {} : { mcp }) };
      const ok = Object.values(parts).every(Boolean);
      json(res, ok ? 200 : 503, { ok, gateway: true, upstreams: parts });
    });
    return;
  }

  const target = UP[route(pathname)];
  const proxied = httpRequest(
    {
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      // X-Forwarded-* so anything downstream can reconstruct the public origin.
      // The proto is PRESERVED when an outer proxy already set it: hard-coding
      // 'http' told everything downstream the request was insecure even when a
      // TLS terminator sat in front, which is exactly the deployment this design
      // claims to support. Same-origin "/" means nothing breaks today; anything
      // that reconstructs an absolute origin from the header would.
      headers: {
        ...req.headers,
        'x-forwarded-host': req.headers['x-forwarded-host'] ?? req.headers.host ?? '',
        'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? 'http',
      },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    },
  );

  proxied.on('error', (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    json(res, 502, {
      error: `stateloom-gateway: ${target.host}:${target.port} is not answering`,
      detail: err.message,
    });
  });

  req.pipe(proxied);
});

/**
 * The websocket half. Node does not proxy an upgrade for you: the 101 and the
 * two raw sockets are yours to splice. Without this the canvas falls back to
 * long-polling if it can, and simply never goes live if it cannot.
 */
server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url ?? '/').split('?')[0];
  const target = UP[route(pathname)];

  const upstream = httpRequest({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: req.headers,
  });

  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    const statusLine = Object.entries(upRes.headers)
      .map(([k, v]) => (Array.isArray(v) ? v.map((one) => `${k}: ${one}`).join('\r\n') : `${k}: ${v}`))
      .join('\r\n');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${statusLine}\r\n\r\n`);
    if (upHead?.length) socket.unshift(upHead);
    if (head?.length) upSocket.unshift(head);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    const bothDown = () => {
      upSocket.destroy();
      socket.destroy();
    };
    upSocket.on('error', bothDown);
    socket.on('error', bothDown);
  });

  upstream.on('error', () => socket.destroy());
  upstream.end();
});

server.listen(PORT, HOST, () => {
  const say = (label, u) => (u ? `\n  ${label.padEnd(7)} → ${u.host}:${u.port}` : '');
  console.error(
    `stateloom-gateway on http://${HOST}:${PORT}` +
      say('canvas', UP.canvas) +
      say('hub', UP.hub) +
      say('mcp', UP.mcp) +
      `\n  the canvas's bridge URL is "/" — same origin, so any host or port the human uses is correct`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // A websocket keeps the server alive forever; do not wait on it.
    setTimeout(() => process.exit(0), 500).unref();
  });
}
