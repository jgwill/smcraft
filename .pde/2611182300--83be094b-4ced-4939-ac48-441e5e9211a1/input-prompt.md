# Brief: the decision model, rispec 85, from proposal to a working first version (jgwill/smcraft#33)

From the factory mail seat (`f1-t6-mailing-and-prep-atelier-jerry-2611131123`, Claude Code, Opus 5.5), 2026-11-18 22:55 EST, on Guillaume's word in that seat: "You could start a new session that would implement a PR of everything that makes sense."

You are a T8 session on Fable 5.2. Your working tree is `/workspace/repos/jgwill/smcraft/.worktrees/85-dmdf`, on branch `rispec/85-dmdf-decision-model`.

## Your task

Make jgwill/smcraft#33 the pull request of the decision model's first working version. Revise rispec 85 with what makes sense from the two documents below, then implement it in the loom, so that Episode 564's advance gate validates, renders and replays through the loom with no call to Jev. Push to the PR's branch, and update the PR's title and description to say what it now holds.

Read first, in this order:
1. `rispecs/85-dmdf-decision-model.spec.md` on your branch, and jgwill/smcraft#32 (its Action Steps are your plan, except the two that are Guillaume's: settling Q1 to Q4, and merging).
2. `perplexity-report-261118.md` beside this brief: the report Guillaume sent the factory (DMN-inspired requirements graph, tables inside decisions, typed AI judgments, "Jev makes judgments, code makes decisions", six phases).
3. `factory-assessment-261118.md` beside this brief: what the factory said fits, what is missing from the report, and the correction that spec 85 already existed.
4. The first document and its fixtures: Episode 564's `advance-gate-261114/` (`advance-gate.dmdf.json`, `advance-gate.dmd.mmd`, `advance-gate.mjs`, `ledger-261114.jsonl` with 16 lines, `README.md`). A second document in the same format: `_staging_for_new_episodes/who-reads-a-session-before-it-exists-261114/decision-model/episode-birth.dmdf.json` in the chronicle.
5. The loom's sibling formats, to follow their pattern: `bridge-protocol/src/erd/`, `bridge-protocol/src/sequence/`, `bridge-protocol/src/system/`, specs 80, 81, 82, and `examples/decision-gate/` (the gate drawn with the three existing kinds: Question kinds choice, score, noul and tandt, ThresholdPolicy, word owner, Ruling).

## What "makes sense" means here

Keep:
- the draft's choices where Q1 to Q4 are still open: `.dmdf.json`, question, table and person logic, and a decision model that can stand alone and also join a system.
- the person's ruling as a decision of its own (`logic.kind: "person"`), never a fallback: an outcome that waits for the word owner, which no bar can skip.

Add to the spec, and implement what is mechanical:
- typed answers per question type (a noul's probability of yes, a choice's distribution and confidence, a score's position on its levels), never one generic number;
- a criterion on every question, a noul included: it is a validation rule. The factory measured why: without one, "is it done" was 83.3% unclassifiable, and the drafts judge read 0.18 to 0.57;
- a question group (the same snapshot, answered independently) kept apart from a dependency edge;
- the hit policy stated on every table (the draft has `hit`);
- each outcome mapped to a machine event where the decision drives a machine (the draft has `event`, `machine`, D008);
- a definition version on the document, recorded with each run;
- a declared failure route (the engine fails or times out) on a model that asks an engine;
- the semantic definition kept apart from the provider binding (`settings.engine` today);
- rulings calibrating the bars (`bar_after` today): specify how a bar moves after rulings; implement only what is mechanical.

Implement, in `bridge-protocol/src/decision/` and `mcp/`:
- types, `isDecisionModelDefinition`, validation (D001 to D008 and the new rules, numbered after them), `renderMermaidDecisions`, `toEngineRequest`;
- a pure evaluator: given a document, input values and recorded answers, it returns the outcome of each table and the rule that fired, as a trace. A bounded rule language, never `eval`;
- system membership (spec 82), behind what Q3 leaves open;
- the MCP tools to read, validate, render and simulate from recorded answers;
- a `stateloom-decision` skill if the other kinds have one each.

The acceptance test, the report's own: given a fixed input snapshot and fixed answers, every caller produces the same outcome and rule trace. Run it on the advance gate: its 16 recorded runs replayed through its table give their recorded bands. Where a recorded run cannot be replayed (the ledger lacks a field), say which and why. Do not invent the missing value.

## Not yours

- No call to Jev or any provider (each run costs paid tokens). No provider adapter in this PR.
- No merge, no push to `main`, no npm publish, no image push, no release. Guillaume merges after answering Q1 to Q4.
- Do not touch the shared checkout `/workspace/repos/jgwill/smcraft` (main is ahead of origin by two commits that are not yours, with untracked files) or the worktree `.worktrees/14-runtime-hardening`. Three tmux panes have that checkout as their folder: `mctgo-2611130417-t8-loomino-cockpit`, `stateloom-companion`, `stateloom-miadi-discussion-integration-feedback-2610210634`. Do not type into them.
- Do not change files in Episode 564's `advance-gate-261114/` or in the handle's `decision-model/`. Copy what a test needs into the PR as a fixture, and name where it came from.
- Do not edit `perplexity-report-261118.md` or `factory-assessment-261118.md`.
- The web canvas for a decision model is a later PR, unless rendering the Mermaid in the existing designer takes one small change.

## Facts verified at 22:49 EST on 2026-11-18

- jgwill/smcraft#33 is open, branch `rispec/85-dmdf-decision-model` at `af4500639bc0df1c1dd55f91f1cdab9f961b8cd9`, one file `rispecs/85-dmdf-decision-model.spec.md`, no comments. The branch contains `origin/main`.
- jgwill/smcraft#32 is open, with the Action Steps above.
- `@miadi/stateloom-protocol` 0.1.16 in `bridge-protocol/` (test: `node --test dist/tests/*.test.js`), `@miadi/stateloom-mcp` 0.4.1 in `mcp/`.
- Episode 564's `advance-gate.dmdf.json` has inputs, knowledge of kinds authority, model and source, seven question decisions (one choice, six nouls), the table `band` with `hit: first` and four rules, and the decision `ruling` with logic kind `person`.

## Completion marks

1. jgwill/smcraft#33 holds your commits (each with `#32` in its subject), its title and description say what it now holds, which tests ran with their real output, and what is left.
2. The tests pass in `bridge-protocol` and `mcp`, including the advance gate's replay.
3. `lane-report.md` beside this brief: what you built, what you left and why, what you would ask Guillaume (his Q1 to Q4, and any new question), and your model class.
4. Last, one line in `DONE` beside this brief: `<ISO time> jgwill/smcraft#33 <head sha> <tests passed>/<tests run>`. The factory mail seat waits on that file.

Commit `lane-report.md` and `DONE` to the chronicle repository on gaia with a pathspec (only those two files), and push. A rejected push means another seat moved first: integrate and push again.
