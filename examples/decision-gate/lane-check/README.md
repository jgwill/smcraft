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

## Which service answers

A key is sent only to the service that issued it. There is no fallback from one to the other.

| Key | Service | Decision endpoint |
|---|---|---|
| `JEV_AI_API_KEY` (made at https://jev-ai.pro/jev-api) | Jev AI, an independent host of a TypeSafe-compatible endpoint | `POST https://jev-ai.pro/api/v1/systemone` |
| `TYPESAFE_API_KEY` (made at https://console.typesafe.ai/keys) | TypeSafe, which makes Jev | `POST https://api.typesafe.ai/v1/systemone` |

When both keys are set, `JEV_AI_API_KEY` wins. `JEV_AI_BASE_URL` and `TYPESAFE_BASE_URL` move a base address. Keep `/api` in Jev AI's base and do not add `/v1`. A Jev AI key sent to TypeSafe answers 401, and so does the reverse.

The lane check calls the endpoint with `fetch`, not TypeSafe's SDK. If code here ever moves to `@typesafe-ai/sdk`, construct its client with `baseURL: 'https://jev-ai.pro/api'` and `retry: { maxRetries: 0 }`. Setting only the key leaves the SDK pointed at TypeSafe.

```bash
node lane-check.mjs models    # the key's service, its address and its models; no inference, no charge
node lane-check.mjs probe     # one small paid decision on a fixed sentence; prints model, answer, usage, balance
```

Measured 2026-10-05 with William's key:
- `models` answered 200 from jev-ai.pro, through Cloudflare. `jev-latest` resolves to `jev-1.13.0`.
- `probe` used 300 input tokens and returned in under a second.
- Asked whether pushed work with an unruled Q4 is finished, it answered 0.04.

## Failures

After https://jev-ai.pro/docs#errors:

| Status | Meaning | What the check does |
|---|---|---|
| 401 | Key missing, invalid or revoked, or sent to the wrong service | Stops |
| 402 | Insufficient balance, or spending paused | Stops |
| 404 | Wrong path | Stops |
| 422 | Invalid request | Stops, and does not resend it unchanged |
| 429, 502, 503, 529 | Confirmed failure | Resends up to 3 times, honouring `Retry-After` |
| 504, timeout, lost connection | Uncertain: the call may already be charged | Stops and does not replay; reports the run id when there is one |

Each decision record keeps the destination and Jev AI's run id (`X-Jev-Run-Id`). The balance headers (`X-Jev-Tokens-Remaining` and the rest) are read into the response; the key and the Authorization header are never written anywhere.

## Configuration

- **This host.** One literal line, `JEV_AI_API_KEY=...`, in `~/.env`. The check reads that file and never sources it. `~/.env` is mode 664 today, so other accounts on gaia can read it. `chmod 600 ~/.env` closes that, if nothing reads it across accounts.
- **Miadi** (`/a/src/Miadi/.env`, mode 670) already holds the same key for server code. Never give it a `NEXT_PUBLIC_` prefix: that would put it in browser code.
- **A service** such as the witness service (`miadi-witness.service`, a user unit with no environment file today) takes it through `EnvironmentFile=%h/.config/miadi/jev.env`, a file at mode 600 holding only the key line. Then `systemctl --user daemon-reload` and a restart.
- **Never** in a repository, a unit file's `Environment=` line, a log, or a chat.

## What leaves the host with `--decider jev`

Only the `state` and the questions, as `--request-dir` writes them:
- the session's first input and latest input, from the hook capture
- the asks naming the session
- commits and pushes its own tool calls reported
- the files it wrote
- its last three messages
- the last 25 rows of its screen

Measured on 2026-10-05 over 46 live lanes, the largest request was 5.8k tokens. Jev's limit is 32k for the state.

The two services keep that text on different terms:

- **Through Jev AI.** Its privacy page (https://jev-ai.pro/privacy, read 2026-10-05) says submitted text is stored while the account is active. TypeSafe processes it, and OpenRouter does when a fallback provider is needed. The data controller is named only as "Jev AI". Its docs say each run is billed from the account's token balance: 300 tokens for the probe.
- **Directly to TypeSafe.** $0.042 per million input tokens. They state Jev is not trained on customer requests. Zero data retention is on their enterprise plan.

Whether lane transcripts may leave the host on either set of terms is the person's decision (Q1). `probe` sends only a fixed sentence.

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
5. **Calibrate.** `calibrate` shows, per class, the lowest cut that agreed with you 95% of the time over at least 20 rulings. Copy `policy.example.json` and set `act_at` and `block_at`. Put your name in `set_by`, then pass the copy with `--policy`. The default model is `jev-latest`; once you calibrate, pin the version it resolved to (`--model jev-1.13.0`). Moving to a new version means calibrating again.
6. **Then act.** With a policy set, the coordinator moves on a finished lane above `act_at`, reopens a stopped-short one, and routes a waiting question. Everything in between stays in `pending`.

## Limits found while building it

- A commit made with `git commit -q` prints no `[branch sha]` line, so it shows only through its push.
- A lane started with a command (`/mia-episode-companion:mia-listen`) has no stated request, so `request_met` has nothing to check against. Asks in the witness ledger give it criteria. Only the `mino` seat keeps one today.
- A transcript over 64 MB is read from its last 2 MB.
- The binding line names the lane, so an agent session started before the session-observability plugin cannot be found.

## Where it goes next

The witness plugin in the orchestration kit already reads the same sources and keeps the asks
ledger, so the lane check belongs there once an issue anchors it. `ISSUE-DRAFTS.md` holds that issue and the matching one for Miadi's worker-stopped route. They are drafts and have not been sent.
