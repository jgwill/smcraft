#!/usr/bin/env node
/**
 * sync-kit-plugin.mjs — carry the design skills and the MCP pin into the
 * `miadi-stateloom` Claude Code plugin of jgwill/miadi-orchestration-kit.
 *
 * The skills are AUTHORED here, in `skills/`. The plugin carries copies,
 * because a plugin installed from a marketplace is a clone of the kit alone:
 * a link into this repository would not survive the install. So the copy is
 * one-way and the authority is stated in every copied SKILL.md's neighbour
 * README (the kit's rule 4 for its claude/ lane).
 *
 * Run it after a release, once `@miadi/stateloom-mcp@<version>` answers on npm:
 *
 *   node scripts/sync-kit-plugin.mjs [--kit <kit root>] [--check]
 *
 * --kit    the kit checkout (default: $MIADI_ORCHESTRATION_KIT_ROOT, else
 *          /workspace/repos/jgwill/miadi-orchestration-kit)
 * --check  report what would change and exit 1 if anything would; write nothing
 *
 * Only the design skills travel. The host skills (setup, docker, service,
 * tailnet) stay in `@miadi/stateloom-skills` for whoever keeps the host.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_SKILLS = [
  "stateloom-design",
  "stateloom-erd",
  "stateloom-sequence",
  "stateloom-system",
  "stateloom-live-loop",
  "stateloom-render",
  "stateloom-rispec",
  "stateloom-codegen",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const kitArg = args.indexOf("--kit");
const kit =
  (kitArg >= 0 && args[kitArg + 1]) ||
  process.env.MIADI_ORCHESTRATION_KIT_ROOT ||
  "/workspace/repos/jgwill/miadi-orchestration-kit";
const plugin = join(kit, "claude", "miadi-stateloom");

if (!existsSync(join(plugin, ".claude-plugin", "plugin.json"))) {
  console.error(`sync-kit-plugin: no plugin at ${plugin} (set --kit or MIADI_ORCHESTRATION_KIT_ROOT)`);
  process.exit(2);
}

const files = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? files(p) : [p];
      })
    : [];

const changes = [];

// Skills: each design skill's directory, verbatim; a skill no longer listed is removed.
for (const skill of DESIGN_SKILLS) {
  const from = join(root, "skills", skill);
  const to = join(plugin, "skills", skill);
  if (!existsSync(from)) {
    console.error(`sync-kit-plugin: ${from} is missing`);
    process.exit(2);
  }
  const src = files(from).map((f) => relative(from, f)).sort();
  const dst = files(to).map((f) => relative(to, f)).sort();
  const differs =
    src.join("\n") !== dst.join("\n") ||
    src.some((f) => readFileSync(join(from, f), "utf8") !== readFileSync(join(to, f), "utf8"));
  if (!differs) continue;
  changes.push(`skills/${skill}`);
  if (!check) {
    rmSync(to, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
  }
}
for (const stale of existsSync(join(plugin, "skills")) ? readdirSync(join(plugin, "skills")) : []) {
  if (DESIGN_SKILLS.includes(stale) || stale === "README.md") continue;
  changes.push(`skills/${stale} (removed)`);
  if (!check) rmSync(join(plugin, "skills", stale), { recursive: true, force: true });
}

// The authority note beside the copies.
const note = `# Copied skills — not the source

These directories are copies of \`skills/<name>\` in jgwill/smcraft, carried here by
\`scripts/sync-kit-plugin.mjs\` at each smcraft release. **jgwill/smcraft is canonical.**
Edit a skill there; an edit here is overwritten by the next sync.
`;
const notePath = join(plugin, "skills", "README.md");
if (!existsSync(notePath) || readFileSync(notePath, "utf8") !== note) {
  changes.push("skills/README.md");
  if (!check) {
    mkdirSync(dirname(notePath), { recursive: true });
    writeFileSync(notePath, note);
  }
}

// The MCP pin follows mcp/package.json.
const version = JSON.parse(readFileSync(join(root, "mcp", "package.json"), "utf8")).version;
const mcpPath = join(plugin, ".mcp.json");
const mcp = readFileSync(mcpPath, "utf8");
const pinned = mcp.replace(/@miadi\/stateloom-mcp@[0-9A-Za-z.\-]+/, `@miadi/stateloom-mcp@${version}`);
if (pinned !== mcp) {
  changes.push(`.mcp.json → @miadi/stateloom-mcp@${version}`);
  if (!check) writeFileSync(mcpPath, pinned);
}

if (!changes.length) {
  console.log(`sync-kit-plugin: ${plugin} is current (stateloom-mcp@${version})`);
  process.exit(0);
}
console.log(`sync-kit-plugin: ${check ? "would change" : "changed"} in ${plugin}:\n  ${changes.join("\n  ")}`);
process.exit(check ? 1 : 0);
