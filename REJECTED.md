# REJECTED.md: Mal's acceptance criteria, accepted or refused, and approaches abandoned

The brief lists eight acceptance criteria, quoted verbatim below. Three hold up against the ledger; five do
not, and each refusal says why with figures. Every figure is reproducible: `npm run replay` prints the actual
run, and each counterfactual (a criterion applied literally) was produced by feeding the engine a modified
event stream. Policy numbers (P1 .. P10) are my design decisions, listed in README.md.

Reference journal for ACC-001: E1 +1200.00, E2 -950.00, E4 +400.00, E5 -185.00, E6 -180.00,
E7 -620.00 (booked D5, value date D2), FEE -25.00 (D5), E9 +620.00 (booked D6, value date D2).
Interest is 0.04 % of a positive closing balance per day, rounded half up (my choice of rounding, P4).

## Criterion 1: ACCEPTED

> "The Day 2 closing ledger balance, evaluated at end of Day 5 and before any fee is assessed, is AED −370.00."

Correct. At the end of Day 5, after E8 and before Day 5's end of day, the entries with value date <= D2 are
E1 (+1200.00), E2 (-950.00) and E7 (-620.00, booked D5 but value-dated D2): 250.00 - 620.00 = **-370.00**.
Holds (Auth-A, released on D4) and later-dated entries (E4 on D3, E5 and E6 on D4) do not affect it, and no
fee exists yet. Asserted by the test "after replaying through E8 (before Day 5 EOD): closingBalance(ACC-001,
D2) = -370.00" in `test/replay.test.ts`.

## Criterion 2: REFUSED

> "E7 causes exactly one overdraft fee to be assessed, on Day 2."

E7 is booked on Day 5. When Day 2's own end of day ran, the balance was **+250.00**, so no fee could be
assessed on Day 2: a fee is booked and value-dated on the day it is assessed, and Day 2 was closed three days
before E7 existed. Under my design (P3: no retroactive fees) E7 does cause exactly one fee, but on **Day 5**,
which closes at -335.00 and ends at -360.00 once the fee is posted. Under a retroactive reading, E7 would
cause **three** fees, on D2 (-370.00), D4 (-335.00) and D5, because D3 stays at +30.00; that run ends at
210.65 instead of 260.67. The criterion is wrong on either reading: "exactly one fee, on Day 2" is not a
result any consistent rule produces.

## Criterion 3: ACCEPTED

> "The Day 4 settlement of Auth-A must be accepted."

Correct. Auth-A was approved on D2 (250.00 - 0 active holds - 200.00 = **50.00** >= 0), so on D4 it is an
active hold. E5 settles it for 185.00, below the 200.00 hold: the debit is posted with value date D4 and the
whole hold is released (P6); the unused 15.00 is not kept as a residual hold. D4 closes at 285.00. Asserted
by "Auth-A: APPROVED on D2 (available after hold 50.00); SETTLED D4 for 185.00, 15.00 released" in
`test/replay.test.ts`.

## Criterion 4: REFUSED

> "Any settlement referencing an authorization ID not present in the ledger must be rejected and the funds must not leave the account."

A cleared settlement is money the card scheme has already paid to the merchant on the issuer's behalf.
Whether the authorization is missing, was taken offline, expired, or never happened, the issuer cannot refuse
the clearing under scheme rules; the remedy is a chargeback. Rejecting E6 (Auth-Z, 180.00) would make the
ledger untruthful: D4 would close at **465.00 instead of 285.00**, D5 at -180.00 after the fee, D6 at 440.00,
and the run would end at **440.83 instead of 260.67**, while 180.00 really had left the bank. My policy P7
posts the debit, raises `UNMATCHED_SETTLEMENT` for review, and leaves recovery to the chargeback process.

## Criterion 5: ACCEPTED (as a statement)

> "If Auth-B is approved, its hold reduces available balance but not ledger balance."

Correct as a statement of how holds work: a hold reduces the available balance and never the ledger balance
(P5; `closingBalance` never reads the authorization register, asserted in `test/ledger.test.ts`). In this
run, however, the condition never fires: Auth-B is **DECLINED** on D5, because the balance as of D5 is
-335.00 and -335.00 - 0 active holds - 90.00 = **-425.00** < 0. A declined request holds nothing.

## Criterion 6: REFUSED

> "After E9, all balances and fees return to their pre-E7 values."

Balances do; fees and accruals do not, by design. After E9 the value-dated ledger balances of D2 .. D4 are
back to 250.00, 650.00 and 285.00. But the ledger is append-only: the 25.00 fee assessed at D5's end of day
stays in the journal, and the D5 accrual memo of 0.00 (written on a close of -360.00) is never restated
(P4, P8). Without E7 and E9 the engine ends at **285.79**: D4, D5 and D6 all close at 285.00, the accruals
are 0.10 + 0.10 + 0.26 + 0.11 + 0.11 + 0.11 = 0.79 and there is no fee (in that run Auth-B would also be
approved, which moves no balance). The actual run ends at **260.67** with accruals summing to 0.67. A fee
returns only through an explicit, human-initiated refund entry with a reason code; `npm run test:gap`
documents the 0.12 gap on purpose.

## Criterion 7: REFUSED

> "The three BHD instalments in E10 must each be BHD 3.334."

3 x 3.334 = **10.002**, which creates 0.002 BHD out of nothing. The correct split of BHD 10.000 (10000 fils)
is 3334 + 3333 + 3333 = 10000 fils, that is **3.334 + 3.333 + 3.333 = 10.000**; the 1 fils remainder goes to
the first instalment (my policy P9). Asserted by the instalment tests in `test/money.test.ts` and
`test/replay.test.ts`.

## Criterion 8: REFUSED

> "If the rounded daily interest accruals do not sum to the capitalized total, the remainder is discarded."

The brief's own capitalisation rule is that the rounded daily accruals sum exactly to the capitalised total.
In this design the capitalised amount *is* the sum of the rounded accruals (0.10 + 0.10 + 0.26 + 0.11 + 0.00
+ 0.10 = 0.67 for ACC-001, 0.004 for ACC-002), so a remainder cannot exist and there is nothing to discard.
A design in which the two could differ would be one that rounds once on a total: 0.04 % of the summed
positive closings (169500 fils x 4 / 10000 = 67.8) rounds to 0.68, one fils away from 0.67, and "discard the
remainder" would then silently decide who loses that fils. Asserted by "capitalised 0.67 ... the EXACT sum of
the rounded memos" in `test/replay.test.ts`.

## Approaches abandoned along the way

- **Floating-point money.** `0.1 + 0.2 === 0.30000000000000004`; `28500 * 0.0004 === 11.400000000000002`,
  which `Math.round` happens to save but a 0.5 case would not; `10 / 3` has no BHD representation. Every
  amount is a `bigint` in minor units and the only rounding is the deliberate one in `roundHalfUp`.
- **Sorting the stream by booked day.** Simpler to reason about, but it puts E10 (booked D5) before E9
  (booked D6): Day 5's end of day would see ACC-002 at 10.000, accrue 0.004 on D5 as well as D6, capitalise
  0.008 and end at 10.008 instead of 10.004, and no `LATE_EVENT` would ever be raised. A live ledger never has
  the whole stream in advance, so I replay in arrival order and flag lateness (my policy P10).
- **Retroactive fees.** A tempting reading of "fee if the day closed negative", refused under criterion 2:
  three fees instead of one, 50.00 of them for a debit that E9 reverses one day later, final 210.65.
- **Auto-refunding fees on reversal.** Friendly to the customer, refused under criterion 6: the engine cannot
  tell a bank error from a disputed purchase, and the refund would move D6 to 285.00 and the end to 285.68,
  rewriting reported history. Refunds are new entries posted by a person with a reason (my policy P8).
- **A mutable `status` field on holds.** Replaced by a derived `holdState` (approved and not yet referenced by
  a settlement entry) so that the authorization register is append-only like the journal.
- **Accruals as ledger entries.** Six tiny INTEREST entries per account would compound inside the window and
  clutter the journal. The brief asks for one capitalising credit at the end of Day 6; I keep the daily
  accruals as memo records until then (my policy P4).
