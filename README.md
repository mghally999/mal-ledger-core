# mal-ledger-core

Append-only ledger replay for the Mal take-home assessment: two accounts (ACC-001 in AED, ACC-002 in BHD),
ten events replayed in the exact order given, end-of-day fees and interest, one capitalisation at the end.

- **TypeScript, strict mode**, executed directly by Node >= 22.6 with `--experimental-strip-types`. No build step.
- **Zero dependencies.** Tests use the built-in `node:test` runner and `node:assert/strict`.
- **Money is never a float.** Every amount is a `bigint` in minor units: AED has 2 decimals (1 AED = 100 fils),
  BHD has 3 (1 BHD = 1000 fils). Amounts only become strings at print time.
- **The ledger is append-only.** Entries are `Object.freeze`d and only ever pushed. Reversals, fees and
  capitalised interest are new entries; nothing is edited or deleted.

Companion documents: [NUMBERS.md](NUMBERS.md) (every constant and why), [AMBIGUITIES.md](AMBIGUITIES.md)
(every judgement call: options, decision, why), [REJECTED.md](REJECTED.md) (criteria refused, approaches
abandoned), [WORKLOG.md](WORKLOG.md) (timestamped milestones).

## Running it

| Command            | What it does                                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| `npm run replay`   | Replays the 10 events and prints the per-day report described below.                  |
| `npm test`         | Runs the 34 tests in `test/money`, `test/ledger` and `test/replay`. Must pass 100%.    |
| `npm run test:gap` | Runs `test/known-gap.test.ts` alone. It **fails on purpose** (asserts 0.79, actual 0.67). |

`npm test` lists its three files explicitly so that the known-gap test can never sneak into the green run.

Optional type check (the project itself has no dependencies; this installs the compiler without saving it
to `package.json`):

```sh
npm install --no-save --no-package-lock typescript@5 @types/node@24 && npx tsc --noEmit
```

## Layout

```
src/money.ts      bigint minor units: toMinor, format, roundHalfUp, splitInstalments
src/ledger.ts     append-only journal: Entry, Auth, closingBalance (P1), authorize (P5), holdState (P6)
src/replay.ts     the engine: event handlers (P7-P10), EOD fee + interest (P2-P4), capitalisation (P4)
src/scenario.ts   the two accounts and the ten events, transcribed from the brief
src/report.ts     plain-text per-day report (presentation only)
src/main.ts       `npm run replay`
test/*.test.ts    node:test suites; known-gap.test.ts is the intentional failure
```

The policies P1 .. P10 are my design decisions, made where the brief is silent or ambiguous:

| Policy | One line                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------- |
| P1     | closing balance for day D = sum of entries booked so far with value date <= D                  |
| P2     | EOD for day D runs when the stream first reaches a later day; Day 6 EOD runs after the last event; order: fee check, then interest |
| P3     | overdraft fee AED 25.00 at EOD if the day closes negative; once per account per day; never retroactive; AED only |
| P4     | interest = round_half_up(closing * 4 / 10000) if closing > 0; memo records, never restated; one capitalising credit on D6 = exact sum |
| P5     | authorization approved iff balance as of the booking day - active holds - new hold >= 0; holds never touch the ledger |
| P6     | matched settlement: debit the settled amount, release the whole hold                           |
| P7     | unmatched settlement: force-post the debit, raise UNMATCHED_SETTLEMENT                         |
| P8     | reversal: new opposite entry with the original's value date, linked to it; no automatic fee refund |
| P9     | instalments: split minor units by count; the first instalment absorbs the remainder            |
| P10    | late event (booked day already closed): post with its own value date, raise LATE_EVENT, do not re-run EOD |

### What comes from the brief, and what I decided

From Mal's brief: the two accounts and the event stream; the 6-day window; the append-only ledger; AED at
2 decimals and BHD at 3; the overdraft fee of AED 25.00, once per account per day on a negative closing and
value-dated that day; 0.04 % daily interest on positive closing balances; capitalisation as one credit at the
end of Day 6 whose rounded accruals sum exactly to the total; the authorization rule (available = ledger
balance - active holds, must stay >= 0 after the new hold); and the eight acceptance criteria discussed in
[REJECTED.md](REJECTED.md).

Mine, made where the brief is silent or ambiguous: everything else in P1 .. P10, including value-dated closing
balances, when EOD runs and the fee-before-interest order, no retroactive fees, the AED-only fee, half-up
rounding, accruals as memo records that are never restated, the remainder going to the first instalment,
force-posting unmatched settlements, no automatic fee refund on reversal, how late events are handled, and
which day a notice belongs to. Each is argued in [AMBIGUITIES.md](AMBIGUITIES.md).

## Reading the replay output

`npm run replay` prints one block per day, then four summary sections.

```
Day 5
  closing   ACC-001 AED -360.00          <- closing balance at EOD, after the fee check (P1, P2)
            ACC-002 BHD 0.000
  fees      FEE-ACC-001-D5 ACC-001 AED 25.00 (value date D5)   <- fee entries booked that day (P3)
  auths     Auth-B DECLINED hold 90.00 (available would be -425.00)   <- auth decisions and settlements of the day (P5-P7)
  notices   AUTH_DECLINED Auth-B: available would be AED -425.00     <- errors/exceptions raised that day
  interest  ACC-001 AED 0.00             <- the day's accrual memo (P4); 0.00 because the day closed negative
            ACC-002 BHD 0.000
```

- **closing** is the balance the day closed at. It is a snapshot taken at EOD, so a later back-valued entry
  (E7, E9) never changes what a past day reports.
- **fees** lists overdraft fees charged at that day's EOD. Exactly one appears in the whole run (D5).
- **auths** shows authorization decisions taken that day and settlements booked that day, with the amount
  released on settlement (Auth-A: hold 200.00, settled 185.00, 15.00 released).
- **notices** are the errors/exceptions: `UNMATCHED_SETTLEMENT` (D4, Auth-Z), `AUTH_DECLINED` (D5, Auth-B),
  `LATE_EVENT` (D6, E10). A notice never changes the ledger.
- **interest** is the memo accrual for the day. It is not an entry; the entries come at capitalisation.

The summary sections:

- **Capitalised interest** shows the single credit per account and the daily memos it is the exact sum of
  (ACC-001: 0.10 + 0.10 + 0.26 + 0.11 + 0.00 + 0.10 = 0.67).
- **Final balances** are `closingBalance(account, D6)` after capitalisation: ACC-001 260.67, ACC-002 10.004.
- **Authorizations (final state)** is derived from the records: ACTIVE, SETTLED or DECLINED.
- **Journal** is the append-only entry list in posting order. Reading it top to bottom is reading history:
  E7 is followed by the D5 fee, then E9 (its reversal, value-dated D2), then E10's three instalments, which
  arrived after E9 even though they are booked D5.

## The known gap

`npm run test:gap` asserts that ACC-001's capitalised interest is 0.79, which is what it would be if
back-valued corrections restated past accruals and the fee caused by E7 were refunded when E7 was reversed.
The real figure is 0.67. The test fails by design to document that this ledger never restates the past and
never refunds fees automatically; the comment at the top of `test/known-gap.test.ts` walks through the 0.12.
