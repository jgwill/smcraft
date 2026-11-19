# What I expect an independent review to find (written before it ran)

2026-11-18, T8 session on Fable 5.2 (claude-fable-5-2), at head 7a08e26. I am sending the
diff af45006..7a08e26 to a fresh reviewer with the brief and the code, not my conclusions.

Where I think the code is weakest, in the order I would look:

1. `decision/ledger.ts`: the ruling in force is kept per run, not per run and person decision,
   so a ledger holding rulings of two person decisions would lose one.
2. `decision/ledger.ts`: a withdrawal with no `withdrawn_ruling_at` withdraws the last ruling on
   the run, which may not be the one meant.
3. `decision/expression.ts`: the number token accepts shapes `Number()` rejects or reads oddly
   (a trailing dot, a leading dot), and exponents are not read.
4. `decision/validate.ts`: D014 checks the `if` of a rule and nothing checks that a `from`
   decision is read by `answered()` first, so a `from` on a missing answer goes to the failure
   route by design, which a reviewer may read as a defect.
5. `decision/evaluate.ts`: under `unique` and `collect` one missing answer fails the whole
   table even when another rule already held.
6. `mcp/src/decision.ts`: `replay_decision_ledger` reads a path under `~` when no document root
   is set.

What I do not expect: a way out of the rule language, or a run whose trace differs between
two callers.
