# Golden fixtures

**A fixture here is a claim about a delivered job, and every number in it must be traceable to a
named artifact.** These are the only end-to-end validation the engine has against work that was
actually built and installed, so they are the last line that catches a plausible-but-wrong answer.

## The rule that matters most

**A fixture asserts only what its source artifact records.**

If the drawing does not state a per-bay level count, the fixture does not assert one — even though
inventing a plausible configuration would make the test look more thorough. A fixture that encodes a
guess is worse than no fixture: it is a wrong answer with a test defending it, and the next person to
touch the engine will trust it.

Anything the artifact does not establish goes in `not_established`, **with the reason**. That section
is not an apology for an incomplete fixture. It is part of the record, and it is what stops someone
filling the gap from imagination in six months.

## Why the reference project's fixtures were not simply copied

`rack-studio/fixtures` contains golden values and **nothing consumes them**. The reuse register flags
this explicitly. A fixture no test reads is a comment that looks like a control — it passes review,
it survives refactors, and it never once fails.

Every fixture in this directory is wired into the test run. If you add one, wire it in the same
commit.

## `carson-0005-01-r1.json`

The Carson Phase 4 as-built count. Three artifacts gave three different figures for one job, and the
disagreement is itself the clearest evidence for why this product exists:

| Artifact | Bays | Net positions |
|---|---|---|
| **Drawing 0005-01 R-1 (as-built)** | **916** | **6,824** |
| Quote `Q-38857-1` | 916 | 7,196 |
| Quote `Q-38857-8` | 551 | 4,268 |

**The drawing governs** (owner decision, `P0-004`). The quotes are priced commercial documents from
different points in the job's life, not statements of what was installed, and they are disregarded.
Their numbers appear in this README and in the fixture's `source.disregarded` **only** so a future
reader knows they were considered and rejected, rather than missed.

The drawing earns its authority arithmetically as well as by provenance: it is the only one of the
three whose own breakdown reconciles.

```
6,980 gross − 156 lost = 6,824 net        exactly
```

### What the fixture asserts, and why it asserts the breakdown

The test checks `gross − lost = net`, **not** just the headline 6,824.

An engine that reaches 6,824 by the wrong route — right total, wrong lost-position accounting — is
still wrong, and a headline-only assertion would pass it. That is the exact failure mode this
product exists to prevent, so the fixture is written to catch it in the engine as well as in a
quote.

### What it deliberately does not assert

`6,980 / 916 = 7.6201`, which is not an integer, so **no uniform level count reproduces the gross
figure**. Carson is a mixed configuration and the drawing does not break it down by run. The fixture
therefore asserts the *totals and their relationship*, and records the per-bay configuration as
unestablished. The 156 lost positions are likewise a total with no recorded per-reason breakdown.

If a future artifact supplies either, extend the fixture and say which artifact supplied it.
