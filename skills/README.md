# stateloom skills

Agent-installable skills for **stateloom / smcraft** — designing, validating, rendering,
generating and specifying hierarchical state machines from a `.smdf.json` document.

Each directory here is a self-contained Claude Code skill. `stateloom skills install <name>`
copies the directory verbatim into the consumer's `.claude/skills/<name>/`, so an agent that
has never seen this repository can load one and act.

## The skills

| Skill | What it covers | Install |
|---|---|---|
| `stateloom-setup` | Standing the whole system up from nothing: npm/PyPI packages, MCP registration, the `.smdf.json` project document, the hub on 4599, the web designer on 4598, the `STATELOOM_*` env contract, and a verification checklist that proves each piece is live. | `stateloom skills install stateloom-setup` |
| `stateloom-design` | Designing a machine conversationally through the 15 MCP tools — tool order, building a hierarchy, reading validation output, and the mistakes that produce V003/V004 errors. | `stateloom skills install stateloom-design` |
| `stateloom-live-loop` | The real-time bridge: agent and human editing one board at once. Hub, rooms keyed by absolute path, presence, `smcx watch`, the web canvas, persist-then-emit, external-edit detection, and diagnosing `○ no disk`. | `stateloom skills install stateloom-live-loop` |
| `stateloom-render` | Drawing the machine from all three surfaces (CLI, MCP, web), the four formats, the PNG rasterizer fallback chain, and `--stamp` export naming. | `stateloom skills install stateloom-render` |
| `stateloom-codegen` | SMDF → validated → generated Python (or TypeScript), the runtime the generated code imports, and how to run the result. | `stateloom skills install stateloom-codegen` |
| `stateloom-rispec` | Emitting a RISE rispec (markdown specification) from a machine with `generate_rispec`, including the PDE-sourced path. | `stateloom skills install stateloom-rispec` |

Install every skill at once:

```bash
stateloom skills install --all
```

## Install target

The default target is `.claude/skills/` in the current working directory. A skill lands as
`.claude/skills/<name>/SKILL.md` plus whatever reference files ship beside it. Claude Code
discovers it on the next session start.

To install into a different root, pass the directory:

```bash
stateloom skills install stateloom-setup --dir /path/to/project/.claude/skills
```

## Reading order

`stateloom-setup` first — every other skill assumes a project document exists and, for the
live surfaces, that the hub is running. After setup, the skills are independent:

```
stateloom-setup
   ├── stateloom-design ──┬── stateloom-render
   │                      ├── stateloom-codegen
   │                      └── stateloom-rispec
   └── stateloom-live-loop
```

## The one rule that saves the most time

`STATELOOM_PROJECT_FILE` must be an **absolute** path. The MCP server, the web app and the
CLI each resolve a relative path against their own working directory — three processes, three
directories, one relative path, silent divergence. It presents in the web toolbar as
`○ no disk`. Every skill here states absolute paths for that reason.
