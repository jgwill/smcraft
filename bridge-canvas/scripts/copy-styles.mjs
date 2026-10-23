#!/usr/bin/env node
/**
 * `tsc` compiles TypeScript and nothing else, so the one non-TS file this
 * package ships — the stylesheet every consumer imports — would never reach
 * `dist/`. Copied here, as the tail of `npm run build`, because a canvas
 * published without its own colours is a canvas nobody can see.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
mkdirSync(dist, { recursive: true });
copyFileSync(join(here, "..", "src", "styles.css"), join(dist, "styles.css"));
console.log("copied src/styles.css → dist/styles.css");
