# What the independent review found, against what I expected

2026-11-19. The reviewer was a fresh agent on Fable 5.2 (`claude-fable-5-2`), the same class
as this session. It read the diff af45006..7a08e26 with the code and the question, and did not
open `review-prediction.md`. It returned 19 findings, 17 confirmed by a script it ran.

## Against the prediction

| I expected | What came back |
|---|---|
| 1. the ruling in force kept per run, not per person | Found, as its first finding. |
| 2. a withdrawal with no time withdrawing the wrong ruling | Not that. It found the other side: a withdrawal that matches nothing changed nothing and said nothing. |
| 3. number tokens read oddly | Not found. 300,000 random token strings never made the parser throw. |
| 4. `from` on a missing answer read as a defect | Not raised. |
| 5. `unique` and `collect` failing whole on one missing answer | Near it, and worse than I thought: rule order decided between a failure route and waiting for a person, so a table could take its failure route while the person it reads had not ruled. |
| 6. a ledger read under `~` with no document root | Checked and found sound. |

I wrote that I did not expect a way out of the rule language, or a run that differs between
callers. The first held. The second did not: an invalid answer's failure text followed the
order its keys arrived in, and a `bars` override named `constructor` added a bar the document
did not have and moved an outcome.

What I had not looked for at all: every reader threw a `TypeError` on a document written in the
wrong shape; a ruling with no outcome, no author or no run was counted as in force; a choice
that wrote narrower `outcomes` than its options passed D006; options named "1", "2", "3" could
not be rotated and nothing said so; a group named `default` hid the loom's own request.

## What was done

All 19 are answered in the commit that carries this file: 17 by code with a test each, one by
wording (the ruling comparison is with what the replay gives, which the text now says), one by
a corrected sentence in the example's README.

Left: a ledger that writes one run id twice counts the ruling on it twice in the comparison.
