/**
 * /api/companion/* — the companion service, as this page reaches it (Spec 84).
 *
 * The Talk dock records takes and reads the conversation of a Mia episode companion
 * (jgwill/miadi-orchestration-kit `claude/mia-episode-companion/phone-capture`). The
 * service listens on its own host and port; the browser asks this server, which passes
 * the request on to `STATELOOM_COMPANION_URL` — the same origin for the page, no CORS
 * to configure, and the service's address never reaches the bundle.
 *
 * Only what the phone page itself does passes: read the thread, the episodes, the
 * health, the recorder's state and the voices; send a take, its backup parts, a
 * diagnostic, the recorder's heartbeat, a thumb, a request to voice a reply. A reply is
 * never posted through here — the service takes replies from its own host only, and
 * every request this route forwards carries `x-forwarded-for`, which is how the service
 * tells a forwarded request from its own seat's.
 *
 * Bodies and audio stream both ways (a take is minutes of audio; a voice is played by
 * byte range).
 */
import { NextRequest } from "next/server";
import { envAlias } from "@miadi/stateloom-protocol";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ID = "[0-9a-f-]{36}";
const READ = [
  /^health$/,
  /^episodes$/,
  /^thread$/,
  /^recorder$/,
  /^replies$/,
  new RegExp(`^replies/${ID}/audio$`),
  new RegExp(`^replies/${ID}/steps/\\d{1,2}/audio$`),
  /^captures\/audio\/[^/]+$/,
];
const WRITE = [
  /^takes$/,
  /^takes\/part$/,
  /^takes\/diagnostic$/,
  /^recorder$/,
  new RegExp(`^replies/${ID}/voice$`),
  new RegExp(`^replies/${ID}/feedback$`),
];

/** The request headers the service reads. */
const PASS_IN = ["content-type", "range", "accept"];
/** The response headers the page needs, for JSON and for ranged audio. */
const PASS_OUT = ["content-type", "content-range", "accept-ranges", "content-length", "cache-control"];

function refuse(status: number, error: string): Response {
  return Response.json({ success: false, error }, { status, headers: { "cache-control": "no-store" } });
}

function allowed(method: string, path: string): boolean {
  const list = method === "POST" ? WRITE : method === "GET" || method === "HEAD" ? READ : [];
  return list.some((re) => re.test(path));
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const base = envAlias("COMPANION_URL");
  if (!base) return refuse(503, "no companion on this designer: set STATELOOM_COMPANION_URL to the phone-capture service");
  const { path: parts = [] } = await ctx.params;
  if (parts.some((p) => p === ".." || p === "." || p.includes("/"))) return refuse(400, "bad path");
  const path = parts.join("/");
  if (!allowed(req.method, path)) {
    return refuse(path === "replies" && req.method === "POST" ? 403 : 404, path === "replies" && req.method === "POST"
      ? "replies are posted from the companion's own host, not through the canvas"
      : `not passed to the companion: ${req.method} ${path}`);
  }

  const target = new URL(`api/${parts.map(encodeURIComponent).join("/")}`, base.endsWith("/") ? base : `${base}/`);
  target.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of PASS_IN) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Never empty: an empty or absent header is what the service reads as its own host.
  const client = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "stateloom-web";
  headers.set("x-forwarded-for", client);
  const login = req.headers.get("tailscale-user-login");
  if (login) headers.set("tailscale-user-login", login);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "POST" ? req.body : undefined,
      // A streamed request body (a take as it is sent) needs half duplex in Node's fetch.
      ...(req.method === "POST" ? { duplex: "half" } : {}),
      cache: "no-store",
      redirect: "manual",
      signal: req.signal,
    } as RequestInit);
  } catch (e) {
    return refuse(502, `the companion did not answer at ${target.origin}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const out = new Headers({ "cache-control": "no-store" });
  for (const name of PASS_OUT) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
