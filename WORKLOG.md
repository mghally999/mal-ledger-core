# Work log

This project was built with Claude Code under my direction: I set the policies, reviewed every file, and can defend every line. Each line below carries the real output of `date "+%Y-%m-%d %H:%M"` taken when the milestone was finished; no timestamp is invented.

- 2026-10-02 15:29 — Milestone 1: project skeleton (package.json scripts replay/test/test:gap, strict tsconfig for Node type stripping, src/ and test/ folders, README stub, this work log).
- 2026-10-02 15:30 — Milestone 2: money module (bigint minor units, toMinor/format, round_half_up, instalment split with remainder to the first instalment) with 10 passing tests.
- 2026-10-02 15:31 — Milestone 3: ledger core (frozen append-only entries, closingBalance by value date, authorizations with holds derived from the records, settlement releases the whole hold) with 9 more passing tests (19 total).
- 2026-10-02 15:34 — Milestone 4: replay engine (events in given order, EOD per P2-P4 with idempotent fee check then interest memo, auth/settle/reversal/instalment handlers per P5-P10, capitalisation on D6) plus scenario data, per-day report and `npm run replay`.
- 2026-10-02 15:36 — Milestone 5: full test suite asserting every expected result (closings, fee, accruals, capitalisation, instalments, auth states, notices, reversal link, frozen records); npm test runs 34 tests, all passing.
