# Ranker baseline

Measured locally with `pnpm exec tsx scripts/benchmark-ranker.ts` against the
synthetic `fixtures/graph-app` repository on 2026-11-16.

The benchmark contains six handwritten tasks and expected relevant file sets.
For each task, recall@k is the number of expected files present in the first k
ranked results divided by the number of expected files for that task. The
reported value is the macro-average across tasks, so every task has equal
weight. The fixture has fewer than ten source files; consequently recall@10
has the same result as recall@5 here.

| Metric | Result |
| --- | ---: |
| Tasks | 6 |
| Macro-average recall@5 | 0.944 |
| Macro-average recall@10 | 0.944 |

The benchmark measures only this small synthetic fixture. It is not evidence
of performance on larger or independently authored repositories; no second
real repository was available for this run. Task definitions and expected
files are in `scripts/benchmark-ranker.ts`.
