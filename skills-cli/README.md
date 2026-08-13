# @miadi/stateloom-skills

[![npm](https://img.shields.io/npm/v/%40miadi%2Fstateloom-skills)](https://www.npmjs.com/package/@miadi/stateloom-skills)

The front door. `stateloom skills install` drops ready-to-use agent skills for the
stateloom / smcraft state-machine design system into `.claude/skills/`.

```bash
npx -y @miadi/stateloom-skills skills install --all
```

## Why this exists

An agent meeting stateloom for the first time has a bootstrapping problem: the
system spans an MCP server, a socket hub, a web canvas, a terminal CLI and a
code generator, and none of that is discoverable from a package description.
This command answers it in one line, after which the agent's own skill loader
carries the knowledge — versioned alongside the code it describes, instead of
pasted into a prompt that drifts away from it.

## Install

```bash
# no install needed — the usual way
npx -y @miadi/stateloom-skills skills install --all

# or keep the `stateloom` command around
npm install -g @miadi/stateloom-skills
stateloom skills list
```

Zero runtime dependencies. This is the command people run through `npx` *before*
they have installed anything, and every dependency is one more thing that can be
unreachable at that exact moment.

## The skills

| skill | covers |
|---|---|
| `stateloom-setup` | standing the whole system up from nothing: packages, MCP registration, the project document, the hub, the web designer, and a verification checklist |
| `stateloom-design` | designing a machine conversationally through the 15 MCP tools — call order, hierarchy, reading validation output |
| `stateloom-live-loop` | the real-time bridge: agent and human on the same board, presence, persist-then-emit, diagnosing divergence |
| `stateloom-render` | drawing the machine from the CLI, the MCP server or the web canvas — four formats, rasterizer fallback, stamped export names |
| `stateloom-codegen` | SMDF → validated → generated Python / TypeScript, and running the result against the runtime |
| `stateloom-rispec` | generating a RISE rispec from a machine, including the PDE-sourced path |

```bash
stateloom skills list                          # names and descriptions
stateloom skills show stateloom-setup          # print one to stdout
stateloom skills install stateloom-setup       # just the one
stateloom skills install --all                 # the whole pack
```

## Commands

```
stateloom skills list [--json]
stateloom skills show <name>
stateloom skills install <name>... [--all] [--dir <path>] [--force] [--dry-run] [--json]
stateloom skills path [--dir <path>]
stateloom mcp-config [--project <file>]
stateloom --version
```

| option | effect |
|---|---|
| `--all` | install every skill in the pack |
| `--dir <path>` | destination directory (default `./.claude/skills`) |
| `--force` | replace a skill that is already installed |
| `--dry-run` | report what would be written, write nothing |
| `--json` | machine-readable output, for `list` and `install` |

An already-installed skill is **kept**, not overwritten. Someone who edited a
skill in place did real work, and a second `install` a month later must not eat
it — `--force` is how you say *yes, replace mine*, and it removes the old
directory first so a renamed reference file cannot survive as a ghost beside the
new one. Re-running `install --all` to top up a tree is therefore idempotent and
exits 0; only a name that does not exist in the pack is a failure.

| environment | effect |
|---|---|
| `STATELOOM_SKILLS_DIR` | overrides the default destination directory |
| `STATELOOM_SKILLS_SOURCE` | overrides the bundled pack being read |

### `stateloom mcp-config`

Prints an MCP client registration block on stdout, with the guidance on stderr
so `stateloom mcp-config > /tmp/mcp.json` stays clean:

```bash
stateloom mcp-config --project "$PWD/statemachine.smdf.json"
```

```json
{
  "mcpServers": {
    "stateloom": {
      "command": "npx",
      "args": ["-y", "@miadi/stateloom-mcp"],
      "env": {
        "STATELOOM_PROJECT_FILE": "/abs/path/statemachine.smdf.json",
        "STATELOOM_BRIDGE_URL": "http://127.0.0.1:4599"
      }
    }
  }
}
```

`STATELOOM_PROJECT_FILE` must be absolute. The MCP server and the web app each
resolve it against their own working directory, and a relative path makes them
disagree silently — the symptom is a canvas that reports `○ no disk` while the
agent is happily writing to a file somewhere else.

## Using it as a library

```ts
import { loadCatalog, installSkill } from "@miadi/stateloom-skills";

for (const skill of loadCatalog()) {
  console.log(skill.name, "—", skill.description);
}

installSkill("stateloom-setup", { dir: "/tmp/agent/skills", force: true });
// → { name: "stateloom-setup", status: "installed", target: "...", files: 1 }
```

`dist/bin.js` is the command; `dist/index.js` is the barrel and has no side
effects, so importing it never exits a process underneath you.

## Where the skills are authored

The canonical pack is `skills/` at the root of
[jgwill/smcraft](https://github.com/jgwill/smcraft), so a reader browsing the
repo finds them where they belong. `skills-cli/scripts/sync-skills.mjs` mirrors
that directory into this package on `build` and again on `prepack`, so a publish
cannot ship a skill that was edited after the last build.

## Part of the stateloom stack

| package | role |
|---|---|
| [`@miadi/stateloom-engine`](https://www.npmjs.com/package/@miadi/stateloom-engine) | the engine — SMDF parser, validator, hierarchical runtime, code generators |
| [`@miadi/stateloom-protocol`](https://www.npmjs.com/package/@miadi/stateloom-protocol) | patch ops, diff/apply, layout, export names — zero dependencies |
| [`@miadi/stateloom-client`](https://www.npmjs.com/package/@miadi/stateloom-client) | framework-agnostic socket.io client |
| [`@miadi/stateloom`](https://www.npmjs.com/package/@miadi/stateloom) | the socket.io hub |
| [`@miadi/stateloom-react`](https://www.npmjs.com/package/@miadi/stateloom-react) | React 19 binding |
| [`@miadi/stateloom-cli`](https://www.npmjs.com/package/@miadi/stateloom-cli) | `smcx` — drive it all from the terminal |
| [`@miadi/stateloom-mcp`](https://www.npmjs.com/package/@miadi/stateloom-mcp) | the MCP server LLM agents design through |
| **`@miadi/stateloom-skills`** | **this package — the skills that teach an agent the rest** |

## License

MIT © Guillaume Isabelle
