# mal-ledger-core

Append-only ledger replay for the Mal take-home assessment.

- TypeScript (strict), run directly by Node >= 22.6 via `--experimental-strip-types`.
- Zero runtime dependencies. Tests use the built-in `node:test` runner.
- Money is never a float: every amount is a `bigint` in minor units (AED fils = 2 dp, BHD fils = 3 dp).

## Scripts

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `npm run replay`   | Replays the 10 events and prints a per-day report.        |
| `npm test`         | Runs the test suite (must pass 100%).                     |
| `npm run test:gap` | Runs the one intentionally failing "known gap" test.      |

(Full documentation is written in Milestone 7.)
