import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server bundle — `.next/standalone/server.js` plus only the
  // node_modules it actually reaches. This is what makes the designer
  // publishable: `@miadi/stateloom-web` ships the built output and runs it with
  // plain node, so a consumer needs neither this repo nor a Next.js toolchain.
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  // Tracing follows next.config.ts into the TypeScript compiler and pulls
  // sharp's platform binaries for an image optimizer this app never invokes —
  // together 53 MB of a 74 MB bundle, none of it reachable at runtime. Excluded
  // so the published designer is a download somebody will actually wait for.
  // Nothing else: @swc/helpers looks like tooling and is required by Next at
  // run time, and excluding it fails at the first require, not at build.
  outputFileTracingExcludes: {
    "*": [
      "**/node_modules/typescript/**",
      "**/node_modules/@img/**",
      "**/node_modules/sharp/**",
    ],
  },
  turbopack: {
    // Widen the module-graph root to the smcraft repo root so the file-linked
    // @miadi/stateloom-* packages (symlinked into node_modules, real paths in
    // ../bridge-*) resolve. With root pinned to the web dir, Turbopack refuses
    // to follow those symlinks outside its boundary.
    root: path.resolve(__dirname, ".."),
  },
  transpilePackages: [
    "@miadi/stateloom-protocol",
    "@miadi/stateloom-client",
    "@miadi/stateloom-react",
  ],
};

export default nextConfig;
