/**
 * STATELOOM_*-first environment reads with SMCRAFT_* fallback — the rename's
 * working alias. One implementation for the whole family (hub, MCP, CLI, web
 * server-side). NEXT_PUBLIC_* client reads cannot use this (Next.js inlines
 * only literal accesses); they keep an explicit `??` chain instead.
 */
export function envAlias(
  suffix: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env[`STATELOOM_${suffix}`] ?? env[`SMCRAFT_${suffix}`];
}
