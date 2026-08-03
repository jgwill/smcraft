#!/usr/bin/env node
/**
 * stateloom — the skills front door for the stateloom / smcraft design system.
 *
 * An agent arriving at this repo for the first time has a bootstrapping problem:
 * the system it is being asked to use spans an MCP server, a socket hub, a web
 * canvas, a CLI and a code generator, and none of that is discoverable from a
 * package description. This command answers it in one line —
 *
 *     npx -y @miadi/stateloom-skills skills install --all
 *
 * — after which the agent's own skill loader carries the knowledge, and the
 * guidance is versioned alongside the code it describes rather than pasted into
 * a prompt that drifts.
 *
 * Argument parsing is hand-rolled and the package has no runtime dependencies,
 * on purpose: this is the command people run through `npx` before they have
 * installed anything, and every dependency is one more thing that can be
 * unreachable at that exact moment.
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, findSkill, skillsRoot } from "./catalog.js";
import { defaultTargetDir, installSkills, type InstallResult } from "./install.js";

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

const USAGE = `stateloom — agent skills for the stateloom / smcraft state-machine design system

Usage
  stateloom skills <command> [options]
  stateloom mcp-config [--project <file>]
  stateloom --version

Commands
  skills list                   list every skill in the pack
  skills show <name>            print a skill's SKILL.md to stdout
  skills install <name>...      copy skills into .claude/skills/
  skills install --all          copy every skill
  skills path                   print where skills would be installed
  mcp-config                    print an MCP client registration block

Run 'stateloom skills --help' for the install options.
`;

const SKILLS_USAGE = `stateloom skills — install the stateloom skill pack into an agent

Usage
  stateloom skills list [--json]
  stateloom skills show <name>
  stateloom skills install <name>... [options]
  stateloom skills install --all [options]
  stateloom skills path [--dir <path>]

Install options
  --all                install every skill in the pack
  --dir <path>         destination directory (default: ./.claude/skills)
  --force              replace a skill that is already installed
  --dry-run            report what would be written, write nothing
  --json               machine-readable output (list and install)

Environment
  STATELOOM_SKILLS_DIR      overrides the default destination directory
  STATELOOM_SKILLS_SOURCE   overrides the bundled skill pack being read

Examples
  npx -y @miadi/stateloom-skills skills install --all
  stateloom skills install stateloom-setup stateloom-design
  stateloom skills install --all --dir ~/.claude/skills --force
  stateloom skills show stateloom-setup | head -40
`;

interface Flags {
  all: boolean;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
  dir?: string;
  project?: string;
  positional: string[];
}

/** Split argv into flags and positionals. Unknown `--flags` are an error. */
function parse(argv: string[]): Flags {
  const flags: Flags = {
    all: false,
    force: false,
    dryRun: false,
    json: false,
    help: false,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--all":
      case "-a":
        flags.all = true;
        break;
      case "--force":
      case "-f":
        flags.force = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--json":
        flags.json = true;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      case "--dir":
      case "-d":
        flags.dir = argv[++i];
        if (!flags.dir) throw new Error("--dir needs a path");
        break;
      case "--project":
      case "-p":
        flags.project = argv[++i];
        if (!flags.project) throw new Error("--project needs a path");
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
        flags.positional.push(arg);
    }
  }
  return flags;
}

const count = (n = 0): string => `${n} file${n === 1 ? "" : "s"}`;

/** Shorten an absolute path against cwd when that reads better. */
function pretty(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}

function cmdList(flags: Flags): number {
  const catalog = loadCatalog();
  if (flags.json) {
    console.log(
      JSON.stringify(
        catalog.map((s) => ({ name: s.name, description: s.description, files: s.files.length })),
        null,
        2
      )
    );
    return 0;
  }
  if (catalog.length === 0) {
    console.error(`No skills found at ${skillsRoot()}`);
    return 1;
  }

  // A skill's description is written for a model choosing whether to load it,
  // so it is deliberately long and trigger-dense. A human scanning `list` wants
  // the first sentence; `show` and `--json` hand over the whole thing.
  const width = Math.max(...catalog.map((s) => s.name.length));
  const room = Math.max(40, (process.stdout.columns || 100) - width - 5);
  console.log(`${catalog.length} skills — install into ${pretty(defaultTargetDir())}\n`);
  for (const skill of catalog) {
    const first = skill.description.split(/(?<=\.)\s/)[0] ?? skill.description;
    const line = first.length > room ? `${first.slice(0, room - 1).trimEnd()}…` : first;
    console.log(`  ${skill.name.padEnd(width)}  ${line}`);
  }
  console.log(`\n  stateloom skills install --all`);
  return 0;
}

function cmdShow(flags: Flags): number {
  const name = flags.positional[0];
  if (!name) {
    console.error("stateloom skills show <name>");
    return 1;
  }
  const skill = findSkill(name);
  if (!skill) {
    console.error(`No skill named '${name}'. Run 'stateloom skills list'.`);
    return 1;
  }
  console.log(readFileSync(resolve(skill.dir, "SKILL.md"), "utf8"));
  return 0;
}

function cmdInstall(flags: Flags): number {
  const catalog = loadCatalog();
  const names = flags.all ? catalog.map((s) => s.name) : flags.positional;

  if (names.length === 0) {
    console.error("Name at least one skill, or pass --all.\n");
    console.error(SKILLS_USAGE);
    return 1;
  }

  const results: InstallResult[] = installSkills(names, {
    dir: flags.dir,
    force: flags.force,
    dryRun: flags.dryRun,
  });

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const base = flags.dir ? resolve(flags.dir) : defaultTargetDir();
    console.log(`${flags.dryRun ? "would install into" : "installing into"} ${pretty(base)}\n`);
    for (const r of results) {
      switch (r.status) {
        case "installed":
          console.log(`  ✓ ${r.name} — ${count(r.files)}`);
          break;
        case "replaced":
          console.log(`  ↻ ${r.name} — ${count(r.files)} (replaced)`);
          break;
        case "exists":
          console.log(`  • ${r.name} — already installed, kept (use --force to replace)`);
          break;
        case "missing":
          console.log(`  ✗ ${r.name} — no such skill`);
          break;
      }
    }
    const wrote = results.filter((r) => r.status === "installed" || r.status === "replaced").length;
    if (wrote > 0 && !flags.dryRun) {
      console.log(`\nStart a new agent session so the skills are picked up.`);
    }
  }

  // A named skill that does not exist is a failed run; an already-installed one
  // is not — re-running install to top up a tree must stay idempotent.
  return results.some((r) => r.status === "missing") ? 1 : 0;
}

function cmdPath(flags: Flags): number {
  console.log(flags.dir ? resolve(flags.dir) : defaultTargetDir());
  return 0;
}

function cmdMcpConfig(flags: Flags): number {
  const project = resolve(flags.project ?? "statemachine.smdf.json");
  const config = {
    mcpServers: {
      stateloom: {
        command: "npx",
        args: ["-y", "@miadi/stateloom-mcp"],
        env: {
          STATELOOM_PROJECT_FILE: project,
          STATELOOM_BRIDGE_URL: "http://127.0.0.1:4599",
        },
      },
    },
  };
  console.log(JSON.stringify(config, null, 2));
  console.error(
    `\n# STATELOOM_PROJECT_FILE must be absolute — the MCP server and the web app\n` +
      `# resolve it from their own working directories, and a relative path makes\n` +
      `# them disagree silently. Install the setup skill for the full wiring:\n` +
      `#   npx -y @miadi/stateloom-skills skills install stateloom-setup`
  );
  return 0;
}

function main(argv: string[]): number {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(version());
    return 0;
  }

  const [group, ...rest] = argv;

  if (!group || group === "--help" || group === "-h" || group === "help") {
    console.log(USAGE);
    return group ? 0 : 1;
  }

  if (group === "mcp-config") {
    return cmdMcpConfig(parse(rest));
  }

  if (group !== "skills") {
    console.error(`unknown command: ${group}\n`);
    console.error(USAGE);
    return 1;
  }

  const [sub, ...args] = rest;
  const flags = parse(args);

  if (!sub || flags.help || sub === "--help" || sub === "help") {
    console.log(SKILLS_USAGE);
    return 0;
  }

  switch (sub) {
    case "list":
    case "ls":
      return cmdList(flags);
    case "show":
    case "cat":
      return cmdShow(flags);
    case "install":
    case "add":
      return cmdInstall(flags);
    case "path":
    case "where":
      return cmdPath(flags);
    default:
      console.error(`unknown 'skills' command: ${sub}\n`);
      console.error(SKILLS_USAGE);
      return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
