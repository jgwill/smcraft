import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Widen the module-graph root to the smcraft repo root so the file-linked
    // @smcraft/bridge-* packages (symlinked into node_modules, real paths in
    // ../bridge-*) resolve. With root pinned to the web dir, Turbopack refuses
    // to follow those symlinks outside its boundary.
    root: path.resolve(__dirname, ".."),
  },
  transpilePackages: [
    "@smcraft/bridge-protocol",
    "@smcraft/bridge-client",
    "@smcraft/bridge-react",
  ],
};

export default nextConfig;
