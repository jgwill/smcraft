import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
