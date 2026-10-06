# lane-check

A coordinator's check on its lanes: for each agent session, is it **finished**, **waiting**,
**working** or **stopped short**? The check asks typed questions over what the lane did, and runs
every answer through the DecisionGate machine drawn beside it (`../decision_gate.smdf.json`) on
smcraft's own interpreter. Below the thresholds a person set, nothing acts on its own.

It reads lanes and never writes to them. It sends nothing off this host until a person chooses a
decider and puts a key in place.

```bash
cd examples/decision-gate/lane-check
node lane-check.mjs check ep140-bosf-implement            # one lane, by tmux session or session id
node lane-check.mjs check --live --request-dir /tmp/lc    # every live lane; writes each request to read
node --test lane-check.test.mjs                           # 20 tests
```

## What one check asks

| Question | Type | Class in the policy |
|---|---|---|
| `lane_status` | Choice: finished, waiting, working, stopped_short | `lane_status` |
| `claims_finished` | Noul: does the last message say the work is done? | `claims_finished` |
| `asks_person` | Noul: does it ask William to decide something? | `asks_person` (owned by William) |
| `ask_N_met` | Noul per ask in the witness ledger that names this session | `ask_met` |
| `request_met` | Noul over the first and latest input, when there are no asks | `ask_met` |

A done claim that the evidence does not support is the pattern seen in ep140 on 2026-10-04. It
shows as `claims_finished` yes beside a `lane_status` other than finished.

## What leaves the host with `--decider jev`

Only the `state` and the questions, as `--request-dir` writes them:
- the session's first input and latest input, from the hook capture
- the asks naming the session
- commits and pushes its own tool calls reported
- the files it wrote
- its last three messages
- the last 25 rows of its screen

Measured on 2026-10-05 over 46 live lanes, the largest request was 5.8k tokens. Jev's limit is 32k for the state.

TypeSafe charges $0.042 per million input tokens, so a full sweep costs under a cent. They state that Jev is not trained on customer requests. Zero data retention is an enterprise plan, so
otherwise retention follows their Data Processing Agreement (https://typesafe.ai/legal/data-processing).
Whether transcripts may leave the host on those terms is the person's decision (Q1).

## The key

Put one line in `~/.env`, or export it in the environment:

```
TYPESAFE_API_KEY=...
```

The file is read, never sourced, and the key is never printed. `TYPESAFE_ENV_FILE` points at
another file. Never put it in a repository.

## The ledger

A run with `--decider jev` appends one decision record per question to
`$LANE_CHECK_LEDGER` (default `~/.miadi/decisions/lane-check.jsonl`, outside every repository).
Its fields follow `../decision_record.erdf.json`: the question, the relation, the thresholds and
who set them, the value, the number and what it measures, `read_status`, band, machine state,
decider version and evidence references. A ruling is a second record that points at a decision.
It keeps the person's words verbatim beside any reading of them.

```bash
node lane-check.mjs pending                                   # ask and owner decisions nobody ruled on
node lane-check.mjs rule <decision-id> --by William --verdict act --words "yes, it's done"
node lane-check.mjs rule <decision-id> --by William --verdict return --words "reopen it" --source spoken_transcribed
node lane-check.mjs calibrate                                 # where cuts would have agreed with the rulings
```

Verdicts are `act`, `hold`, `deepen`, `return`, `defer` and `no`. Sources are `typed`,
`question_box`, `spoken_transcribed` and `circle_turn`.

## The experiment

1. **Read before sending.** Run `check --live --request-dir <dir>` and read two or three requests. Decide whether that content may go to TypeSafe (Q1).
2. **First run, few lanes.** With the key in place, run `check <lane> --decider jev` on three to five lanes whose real state you know. Every threshold in `policy.example.json` is null, so every answer lands in the ask band and nothing acts.
3. **Rule.** `pending` lists them. Rule on each one with your own words, or have the witness carry your words with `--source`.
4. **Repeat** across a week of sweeps, until each class has a few dozen rulings.
5. **Calibrate.** `calibrate` shows, per class, the lowest cut that agreed with you 95% of the time over at least 20 rulings. Copy `policy.example.json` and set `act_at` and `block_at`. Put your name in `set_by`, then pass the copy with `--policy`. Pin the model version (`--model`, default `jev-1.13.0`). Moving to a new Jev version means calibrating again.
6. **Then act.** With a policy set, the coordinator moves on a finished lane above `act_at`, reopens a stopped-short one, and routes a waiting question. Everything in between stays in `pending`.

## Limits found while building it

- A commit made with `git commit -q` prints no `[branch sha]` line, so it shows only through its push.
- A lane started with a command (`/mia-episode-companion:mia-listen`) has no stated request, so `request_met` has nothing to check against. Asks in the witness ledger give it criteria. Only the `mino` seat keeps one today.
- A transcript over 64 MB is read from its last 2 MB.
- The binding line names the lane, so an agent session started before the session-observability plugin cannot be found.

## Where it goes next

The witness plugin in the orchestration kit already reads the same sources and keeps the asks
ledger, so the lane check belongs there once an issue anchors it. `ISSUE-DRAFTS.md` holds that issue and the matching one for Miadi's worker-stopped route. They are drafts and have not been sent.
