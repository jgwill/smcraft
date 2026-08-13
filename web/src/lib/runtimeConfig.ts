/**
 * runtimeConfig — where the browser learns the bridge URL.
 *
 * Two sources, in this order:
 *
 *  1. `GET /api/config`, answered by the server process the operator started,
 *     reading their own `STATELOOM_BRIDGE_URL`. This is what makes a *prebuilt*
 *     designer publishable — the bundle carries no one's URL.
 *  2. The build-time `NEXT_PUBLIC_*` value, for a copy built from source with
 *     the env already set. Unchanged behaviour for anyone doing that.
 *
 * Resolved once and memoized: several components ask, and they must all get the
 * same answer or half the app would talk to a hub the other half does not know
 * about.
 */

export interface RuntimeConfig {
  bridgeUrl: string | null;
  projectFile: string | null;
}

/**
 * The value inlined at build time, if any. `NEXT_PUBLIC_*` is substituted only
 * for literal property accesses, so the rename alias is an explicit twin chain
 * here rather than a call to `envAlias`.
 */
export function buildTimeBridgeUrl(): string | undefined {
  const url =
    process.env.NEXT_PUBLIC_STATELOOM_BRIDGE_URL ??
    process.env.NEXT_PUBLIC_SMCRAFT_BRIDGE_URL;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

let pending: Promise<RuntimeConfig> | null = null;

/** Fetch (once) the configuration this designer should run against. */
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (pending) return pending;
  pending = (async () => {
    const fallback = buildTimeBridgeUrl() ?? null;
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (r.ok) {
        const body = (await r.json()) as Partial<RuntimeConfig>;
        return {
          // A server that names no bridge does not override one baked into the
          // build — it just has nothing to add.
          bridgeUrl: body.bridgeUrl || fallback,
          projectFile: body.projectFile ?? null,
        };
      }
    } catch {
      // Older server, or none reachable: fall back to whatever the build knew.
    }
    return { bridgeUrl: fallback, projectFile: null };
  })();
  return pending;
}
