# Issue drafts for the lane check

Drafted 2026-10-05 in session `miadi-jev` and not sent. Opening an issue reaches people, so each
one waits for William's word. The body under each title is the verbatim text to send.

---

## Draft 1 · jgwill/miadi-orchestration-kit

**Title:** A coordinator knows which lanes are finished, from typed answers checked against their asks

### Context

The witness plugin (`claude/miadi-witness`) reads every session's binding line, first input and
latest input, and keeps William's asks verbatim in a ledger per seat (`scripts/asks-lib.mjs`). Its
links carry question, trace, evidence, criteria and judgment (`scripts/links-lib.mjs`).

It does not answer the question a coordinator asks most: is a lane finished, waiting, still working,
or stopped short? Pane state does not answer it, because `idle` and `done` decay into each other
(dispatch-discipline §6). A lane's own last message does not answer it either. Miadi measured a
classifier over last messages at 83.3% unclassifiable across 4,294 values
(`jgwill/Miadi` `app/api/a2a/v2/worker-stopped/route.ts`).

On 2026-10-04 the ep140 lane reported "BOSf is in production" while its own reviewer had written
"Q4 is answered in code without a ruling". A second deploy followed.

A working reference now exists in `jgwill/smcraft` `examples/decision-gate/lane-check/`. It asks
four typed questions per lane, with one Noul per ask. The decider is pluggable: dry, or TypeSafe's
Jev. Every answer runs through the DecisionGate machine. With no thresholds set, everything lands in
the ask band. It keeps a ledger of decisions and rulings and a calibration report, and has 20 tests.
A dry sweep of 46 live lanes sent nothing, and the largest request was 5.8k tokens.

### Desired State

The witness plugin carries the lane check. A coordinator runs one command and reads, per lane, a
status with its confidence and band. The decisions that need William sit in one queue. His
rulings, kept in his own words, set the thresholds the coordinator acts on.

### Action Steps

- [ ] Move `lane-check` from `jgwill/smcraft` `examples/decision-gate/lane-check/` into `claude/miadi-witness/scripts/`, importing the witness libraries directly. The DecisionGate machine and the smcraft engine stay as dependencies.
- [ ] Add a `/lane-check` command and a section in the witness skill: when to run it, how to read a band, how to rule.
- [ ] Show the queue (`pending`) on the witness service page beside William's asks.
- [ ] Give lanes asks: the inventory-keeper records a lane's asks when it records the lane, so `ask_met` has criteria beyond the first input.
- [ ] After William's choice of decider and key, run the experiment in the README and record the first calibration in this issue.

### Structural Tension

Lanes stop and say they are done, and William sorts out which really are. The witness already
holds the asks and the evidence that could answer this, but no typed answer connects them, so the
coordinator still guesses from the pane.

### Related

- jgwill/miadi-orchestration-kit#59 (witness plugin)
- jgwill/miadi-orchestration-kit#56 (session capture and the binding line)
- jgwill/medicine-wheel#155 (numbers are not gates in Wilson's name; thresholds are set by a person)
- `jgwill/smcraft` `examples/decision-gate/` (the system: machine, ERD, two scenarios)
- Decision Gate page: https://claude.ai/artifact/EvAJ39jwqwnc5h8JauYmSC

---

## Draft 2 · jgwill/Miadi

**Title:** A worker's stop carries a typed answer to "is it done", checked against its task's criteria

### Context

`app/api/a2a/v2/worker-stopped/route.ts` records that a worker stopped and deliberately decides
nothing. A classifier over `last_assistant_message` was 83.3% unclassifiable across 4,294 values,
so "a stop is a fact; done is a judgement".

The conductor's reviewer (`packages/hermes-conductor/src/roles/reviewer.ts`) returns a boolean. A
person is asked only when the reviewer rejects (`humanGate`). An approval is never questioned.

`runtime/tide-runtime/tide_runtime/models.py` defines confidence thresholds of 40, 50, 70 and 80
for automatic action. `THRESHOLD_AUTO_ACTION` is never used outside its definition.

### Desired State

When a worker stops, the manager reads a typed answer per acceptance criterion of the task, each
with a probability. It also reads a status of finished, waiting, working or stopped short, with a
confidence. Above a threshold William set, the manager acts. Between the thresholds, the task waits
for a person, approvals included. Every answer and ruling is kept beside the stop event.

### Action Steps

- [ ] Give a task contract explicit criteria, one line each, that a Noul can be asked about.
- [ ] On a worker stop, ask the decider one Noul per criterion plus the status Choice. Store the answers with the stop event, never in place of it.
- [ ] Replace the reviewer's boolean with the band: act, ask or block. Ask a person in the ask band whatever the direction.
- [ ] Wire tide's thresholds to the band policy, or remove them. A value that nothing reads misleads its reader.
- [ ] Use the decision record shape from `jgwill/smcraft` `examples/decision-gate/decision_record.erdf.json`, so the kit's lane check and Miadi share one ledger format.

### Structural Tension

Miadi records that a worker stopped but cannot say whether the work is done. The question was asked
of the wrong input, the last message, instead of the task's criteria with the evidence beside them.

### Related

- jgwill/miadi-orchestration-kit (Draft 1 above, once opened)
- jgwill/medicine-wheel#155
- `jgwill/smcraft` `examples/decision-gate/lane-check/`
- Decision Gate page: https://claude.ai/artifact/EvAJ39jwqwnc5h8JauYmSC
