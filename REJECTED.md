# REJECTED.md: criteria refused, criteria accepted, approaches abandoned

> **Numbering note.** The brief's numbered criteria list was not included in the instructions this repository
> was built from; only the verdicts were ("2, 4, 6, 7, 8 refused; 1, 3, 5 accepted"). The headings below
> reconstruct each criterion's substance from the policies and expected results. If the original wording
> differs, rename the headings; the reasons and numbers stand on their own.

Every figure below is reproducible with `npm run replay` (actual run) or by hand from the journal:
E1 +1200.00, E2 -950.00, E4 +400.00, E5 -185.00, E6 -180.00, E7 -620.00 (vd D2), FEE -25.00 (D5),
E9 +620.00 (vd D2), interest rate 4/10000 half-up.

## Accepted

### Criterion 1: the closing balance of a day is value-dated (accepted)

`closingBalance(account, D)` sums entries booked so far with value date <= D. After E8 the D2 figure is
**-370.00** (250.00 - 620.00) because E7 is value-dated D2 even though it was booked D5.
Accepted because that is what a value date is for: the alternative, a booked-day balance, would report D2 as
250.00 forever, make back-valuing meaningless, and let Auth-B on D5 be decided without E7 (available 285.00 -
90.00 = 195.00, approved) when the account was in fact at -335.00.

### Criterion 3: authorizations are decided against the value-dated balance minus active holds (accepted)

Auth-A on D2: 250.00 - 0 - 200.00 = **50.00**, approved; the 200.00 hold does not change the ledger balance.
Auth-B on D5: -335.00 - 0 - 90.00 = **-425.00**, declined; a declined request holds nothing.
Accepted because a hold is a promise, not a movement of money; keeping holds in their own register keeps the
journal and P1 pure and lets a hold's state be derived (ACTIVE / SETTLED / DECLINED) instead of mutated.

### Criterion 5: an instalment credit is split in minor units, exactly, with the remainder on the first (accepted)

BHD 10.000 = 10000 fils; 10000 / 3 = 3333 remainder 1; instalments **3.334 + 3.333 + 3.333 = 10.000**.
Accepted because the split is exact by construction and deterministic. The float alternative,
`10 / 3 = 3.3333333333333335`, cannot even be written as a BHD amount.

## Refused

### Criterion 2: charge the overdraft fee retroactively for past days a back-valued entry made negative (refused)

E7 (booked D5, value date D2) makes D2 close at -370.00 and D4 at -335.00; D3 stays at +30.00. Charging D2
and D4 as well would mean **three fees, 75.00 instead of 25.00**: D5 would close at -410.00, D6 at 210.00
(accrual 8.4 -> 0.08), capitalised interest 0.65 and a final balance of **210.65 instead of 260.67**.
Refused because the next event in the stream, E9, reverses E7: the customer would be holding 50.00 of
penalties for a bank-side debit that no longer exists. EOD is a one-shot process per day (P3); a back-valued
entry is a reason for operations to review, not for the engine to punish the past.

### Criterion 4: reject a settlement that has no matching authorization (refused)

Auth-Z settles 180.00 on D4 with no prior auth. Rejecting it would close D4 at 465.00 (accrual 0.19), D5 at
-180.00 after the fee, D6 at 440.00 (accrual 0.18), capitalised **0.83** and a final balance of **440.83**
instead of 260.67. All of that would be fiction: the scheme has already paid the merchant 180.00 on the
issuer's behalf. Refused in favour of P7: force-post the debit and raise `UNMATCHED_SETTLEMENT` so the
money is on the books today and the dispute (chargeback) can be pursued with the facts.

### Criterion 6: restate past interest accruals when a back-valued correction arrives (refused)

Restating D2 .. D4 after E7 would move their accruals to 0.00, 0.01 (30.00 x 4 / 10000 = 1.2 -> 1) and 0.00,
and restating again after E9 would move them back to 0.10, 0.26, 0.11: three days rewritten twice within two
days. At the end of the run restatement alone gives **0.77** (D5 and D6 both re-accrued on 260.00), and
restatement plus the fee refund of criterion 7 gives **0.79**. This ledger produces **0.67** and
`npm run test:gap` asserts 0.79 on purpose to fail and document the 0.12.
Refused because an accrual is a memo of what was true at EOD (P4); figures already reported never change.
A correction, if wanted, is a new adjustment entry with a reason, visible in the journal.

### Criterion 7: automatically refund a fee when the entry that caused it is reversed (refused)

The D5 fee was correct on D5's facts (closing -335.00). Refunding it when E9 arrives would make D6 close at
285.00, accrue 0.11 instead of 0.10, capitalise **0.68** and end at **285.68** instead of 260.67.
Refused because a reversal event carries no reason: a bank error and a disputed purchase look identical in
the stream, and only the first deserves an automatic refund. The engine would also need a counterfactual
("would D5 have been negative without E7?") that is clean only when one entry is the sole cause. Refunds are
new FEE-reversal entries posted by a person with a reason code (P8).

### Criterion 8: process events in booked-day order (sort the stream, or re-run a closed day's EOD) (refused)

Sorting puts E10 (booked D5) before E9 (booked D6). Day 5's EOD would then see ACC-002 at 10.000 and accrue
0.004 on D5 as well as D6: capitalised **0.008** and a final balance of **10.008 instead of 10.004**, and
no `LATE_EVENT` would ever be raised. Re-running Day 5's EOD when E10 arrives gives the same 10.008 plus a
second D5 memo for ACC-002, which is criterion 6 by another route.
Refused because the stream order is the order in which the bank learned things: a live ledger never has the
whole stream in advance, and hiding lateness hides an operational problem. P10 posts E10 with its true value
date (D5), raises the notice, and leaves Day 5 closed.

## Approaches abandoned along the way

- **Floating-point money.** `0.1 + 0.2 === 0.30000000000000004`; `28500 * 0.0004 === 11.400000000000002`,
  which `Math.round` happens to save but a 0.5 case would not; `10 / 3` has no BHD representation. Every
  amount is a `bigint` in minor units and the only rounding is the deliberate one in `roundHalfUp`.
- **Sorting the stream by booked day.** Simpler to reason about, wrong for the reasons in criterion 8: it
  changes ACC-002's result (10.008) and erases the LATE_EVENT.
- **Retroactive fees.** A tempting reading of "fee if the day closed negative", refused in criterion 2
  (75.00 of fees, 50.00 of them for a reversed debit).
- **Auto-refunding fees on reversal.** Friendly to the customer, refused in criterion 7 because the engine
  cannot tell an error from a dispute, and it changes reported D5/D6 history.
- **A mutable `status` field on holds.** Replaced by a derived `holdState` (approved and not yet referenced by
  a settlement entry) so that the authorization register is append-only like the journal.
- **Accruals as ledger entries.** Six tiny INTEREST entries per account would compound inside the window and
  clutter the journal; the brief's memo-then-capitalise split keeps the journal to one credit per account.
