/**
 * GET /api/config — the browser's runtime configuration.
 *
 * `NEXT_PUBLIC_*` is inlined into the client bundle at BUILD time, which is
 * fine when every operator builds their own copy and was the reason this app
 * could not be published: a prebuilt bundle would carry whoever-built-it's
 * bridge URL, baked in and unchangeable.
 *
 * So the client asks the server instead. This route is evaluated per request on
 * the operator's own machine, reads their `STATELOOM_BRIDGE_URL`, and hands it
 * back. The build-time value stays as a fallback so a locally built dev copy
 * behaves exactly as it always has.
 */
import { envAlias } from "@miadi/stateloom-protocol";

// Never cached and never statically evaluated: the whole point is that this
// answer comes from the environment of the process serving the request.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  return Response.json(
    {
      bridgeUrl: envAlias("BRIDGE_URL") ?? null,
      projectFile: envAlias("PROJECT_FILE") ?? null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
