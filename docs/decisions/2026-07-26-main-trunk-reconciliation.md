# Decision — `main` trunk and version reconciliation (2026-07-26)

## The three truths that disagreed

| Truth | State before |
|---|---|
| `master` | tip `28b1113`, newest commit 2026-04-07, no bridge, no interpreter |
| npm registry | `smcraft@0.3.0`, cut from `14-runtime-hardening` (PR #15) |
| working checkout | `12-realtime-design-bridge` (PR #16), `ts/package.json` 0.1.2 |

Both PR branches contained all of `master` plus a shared segment up to
`ec8e0a1`; neither contained the other. `14-runtime-hardening` added the SMDF
interpreter and the 0.3.0 release; `12-realtime-design-bridge` added the five
bridge/cli packages.

## Decision

1. **Trunk:** new branch `main`, assembled as `origin/master` (`28b1113`)
   + merge `14-runtime-hardening` (`59d1d9e`, PR #15) **first** — so no merge
   order can un-publish the interpreter the registry already ships —
   + merge `12-realtime-design-bridge` (`b2c6b73`, PR #16). Both merges were
   conflict-free. `main` becomes the repository default; `master` is retained
   as history.
2. **Versions:**
   - `smcraft` (ts/): **0.4.0** — the registry holds 0.3.0; the bridge is a
     feature. `main` may never ship lower than the registry.
   - `@miadi/stateloom-protocol`, `@miadi/stateloom-client`, `@miadi/stateloom`,
     `@miadi/stateloom-react`, `@miadi/stateloom-cli`, `smcraft-mcp`: **0.1.0**, first
     publish, pending Guillaume's word.
   - `web`: private, unversioned surface.
3. **Intra-repo `file:` dependencies** between the packages stay as-is in the
   working tree; they are rewritten to published ranges at publish time by the
   release script (shape borrowed from `jgwill/medicine-wheel`).

Also corrected here: `ts/package-lock.json` still carried 0.1.2 from before
the 0.3.0 bump; the lock now follows the manifest.

## Addendum — naming (same day, Guillaume's word)

The five bridge-family packages publish under the `@miadi` scope as the
**stateloom** family: `@miadi/stateloom` (hub), `-protocol`, `-client`,
`-react`, `-cli`. Chosen to keep smcraft's compound shape (state + craft-tool)
while standing apart from forgewright's designer surface — a loom beside a
forge, sibling crafts. `smcraft` (published 0.3.0 lineage) and `smcraft-mcp`
keep their names; directory names unchanged. Rename surface measured in
`~/workspace/.mino/handoff/260726-smcraft-rename-surface.md`: 45 files,
locks regenerated, 69/69 tests green post-rename, local-registry publish +
615-package consumer install re-proven under the new names.
