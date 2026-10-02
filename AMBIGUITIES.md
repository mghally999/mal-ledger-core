# AMBIGUITIES.md: every judgement call, with options, decision and why

Each item: what the brief leaves open, the options I saw, what this implementation does, and why.
Policy numbers (P1 .. P10) refer to the table in README.md; the code comments cite the same numbers.

## 1. When is the "closing balance" of a day evaluated?

- **Ambiguity:** `closingBalance(account, D)` is "the sum of all entries booked so far with value date <= D".
  "So far" changes as the stream advances: after E7 (booked D5) the D2 figure is -370.00; after E9 (booked
  D6) it is back to 250.00. Which figure is "the closing balance of D2"?
- **Options:** (a) whatever the function returns whenever you ask; (b) the figure at the moment Day D's EOD
  ran; (c) the figure at the end of the replay.
- **Decision:** both (a) and (b), kept separate. `closingBalance` is always live (a) and usable at any point
  of the replay (P1). EOD takes a snapshot of it into `eodLog` (b), and fees, interest and the per-day report
  all use that snapshot.
- **Why:** the snapshot is the number that was acted upon. A statement issued for D2 must not change because
  of something booked on D5; the live function is still needed to decide fees, interest and authorizations.

## 2. Retroactive fees for days made negative by a back-valued entry

- **Ambiguity:** E7 (620.00, booked D5, value date D2) turns D2 into -370.00 and D4 into -335.00 after their
  EODs already ran (D3 stays at +30.00). Should D2 and D4 now be charged?
- **Options:** (a) charge 25.00 for each past day that is negative now; (b) charge nothing for the past, only
  the normal fee at the next EOD if the day closes negative; (c) charge once "for the correction".
- **Decision:** (b). Exactly one fee in the run: D5, the first EOD that actually closed negative (P3).
- **Why:** (a) would charge 50.00 extra for a bank-side correction that E9 reverses one day later, leaving
  the customer with 75.00 of fees for a debit that no longer exists. EOD is a one-shot process per day; what
  needs review after a back-valued entry is a job for operations, with a notice, not a penalty.

## 3. The unused part of a hold after a partial settlement

- **Ambiguity:** Auth-A holds 200.00; E5 settles 185.00. What happens to the other 15.00?
- **Options:** (a) keep a residual hold of 15.00 until some expiry; (b) release the whole hold on settlement;
  (c) settle only up to the hold and reject the excess.
- **Decision:** (b): the settlement debits 185.00 and the whole 200.00 hold is released (P6). A matched
  settlement always posts the settled amount, even if it exceeded the hold: the hold is a reservation, not a
  cap on what the scheme may clear.
- **Why:** a settlement completes the purchase the hold was for; keeping 15.00 blocked would reserve money for
  a transaction that has already finished. Incremental authorizations (hotels, car hire) are out of scope.

## 4. An AED fee on a BHD account

- **Ambiguity:** the fee is "AED 25.00". ACC-002 is a BHD account. What if it closes negative?
- **Options:** (a) convert at an FX rate (none is given); (b) charge BHD 25.000 (a different value, about
  2.5x more); (c) do not assess the fee on non-AED accounts and say so.
- **Decision:** (c). `chargeOverdraftFee` skips non-AED accounts and raises `FEE_SKIPPED_NON_AED` so the
  gap is visible. ACC-002 never goes negative in this run, so the notice never fires; it exists so that a
  silent zero can never hide a missed fee.
- **Why:** inventing an FX rate or a BHD tariff is a pricing decision, not a ledger decision. A loud notice
  is the honest behaviour until the tariff is defined.

## 5. A settlement with no matching authorization (Auth-Z)

- **Ambiguity:** E6 settles 180.00 for Auth-Z, which was never authorized.
- **Options:** (a) reject it; (b) park it in a suspense account; (c) post the debit and raise an exception.
- **Decision:** (c): force-post the DEBIT with value date D4 and raise `UNMATCHED_SETTLEMENT` for
  review/chargeback (P7). D4 therefore closes at 285.00, not 465.00.
- **Why:** card schemes do not let an issuer refuse cleared funds: the merchant has been paid. Rejecting it
  would leave an unreconciled 180.00 liability; posting it keeps the ledger truthful and the dispute process
  (chargeback) is the correct place to get the money back if the clearing was wrong.

## 6. Does a reversal refund the fee the original entry caused?

- **Ambiguity:** E9 reverses E7. E7 is what made D5 close negative and incur the 25.00 fee. Should the fee go
  too?
- **Options:** (a) auto-refund the fee when its cause is reversed; (b) never refund automatically; (c) refund
  only when the reversal is flagged "bank error".
- **Decision:** (b) (P8). The fee stays; a refund, if the bank decides one is due, is a new FEE-reversal entry
  posted by a human with its own reason code. The journal does not currently contain one.
- **Why:** the fee was correct on the facts at D5 EOD (closing -335.00). A reversal event carries no reason;
  automating the refund would decide a customer-service question inside the ledger engine and would need a
  counterfactual ("would D5 have been negative without E7?") that is only clean when a single entry is the
  cause. This is half of the 0.12 gap in `test/known-gap.test.ts`.

## 7. Restating past interest after a back-valued entry

- **Ambiguity:** after E7, the D2 .. D4 balances used for accruals are no longer what the ledger says they
  were. Should the accruals be recomputed?
- **Options:** (a) restate: recompute every affected day's accrual whenever a back-valued entry arrives; (b)
  never restate; the accrual is a memo written once at EOD.
- **Decision:** (b) (P4). ACC-001 capitalises 0.67 = 0.10 + 0.10 + 0.26 + 0.11 + 0.00 + 0.10.
- **Why:** (a) would restate D2 .. D4 twice within two days (down after E7, back up after E9), changing
  figures already reported. It would give 0.77 with restatement alone and 0.79 with the fee refund of item 6
  as well; `npm run test:gap` documents the 0.79 and fails on purpose. If a restatement is ever wanted, it is a
  new adjustment entry with a reason, not a rewrite of the memo log.

## 8. E10 arrives out of order (booked D5, after Day 5 EOD and after E9 of D6)

- **Ambiguity:** the stream says E10 is booked D5 but it arrives after a D6 event. Day 5 is closed.
- **Options:** (a) sort the stream by booked day before replaying; (b) re-run Day 5 EOD; (c) post it with its
  own value date (D5), raise `LATE_EVENT`, and leave Day 5 closed.
- **Decision:** (c) (P10). The three instalments are value-dated D5, the notice is raised on D6 (the day the
  stream was in), ACC-002's D5 closing stays 0.000 and its D6 closing is 10.000, so the only accrual is D6's
  0.004.
- **Why:** the order of the stream is the order in which the bank learned things; sorting would hide the
  lateness and needs the whole stream in advance, which a live ledger never has. Re-running EOD would restate
  (item 7) and break idempotency (item 12). With (a) or (b) ACC-002 would accrue 0.004 on D5 as well and end
  at 10.008 instead of 10.004.

## 9. Which instalment absorbs the remainder

- **Ambiguity:** 10.000 BHD / 3 is 3.333 with 1 fils left over. Who gets the fils?
- **Options:** (a) the first instalment; (b) the last; (c) round-robin across instalments.
- **Decision:** (a) (P9): 3.334, 3.333, 3.333.
- **Why:** the brief says first; it is deterministic, trivially verifiable, and the sum is exact by
  construction (`share * count + remainder`). (b) would be equally exact; (c) is pointless because the
  remainder is always smaller than the count.

## 10. Rounding mode

- **Ambiguity:** "round" for 11.4, 10.4 and future values of x.5.
- **Options:** half-up, half-even (banker's), half-down, truncation.
- **Decision:** half-up, implemented on integers (`remainder * 2 >= denominator`), P4.
- **Why:** it is the rounding a customer can check by hand and the brief names it. This scenario has no exact
  half, so every mode gives 0.67 today; the mode is pinned so that tomorrow's data cannot change it silently.
  Truncation was rejected because it is always against the customer.

## 11. Interest on a zero or negative balance

- **Ambiguity:** D5 closes at -360.00. Negative interest? Debit interest? Zero?
- **Options:** (a) charge debit interest on overdrafts; (b) accrue zero; (c) accrue on the pre-fee balance.
- **Decision:** (b): `closing > 0 ? round_half_up(...) : 0` (P4). The accrual uses the post-fee balance
  because the brief fixes the EOD order "fee check, then interest"; on D5 both are negative so the order does
  not change the 0.00, but it would matter for a balance between 0.00 and 25.00.
- **Why:** the overdraft penalty is the flat fee (P3), not a rate. A zero balance earns nothing because there
  is nothing to earn on.

## 12. Holds versus the ledger balance

- **Ambiguity:** is a hold an entry? Does it reduce the balance?
- **Options:** (a) post a pending entry and reverse it on settlement; (b) keep holds in a separate register
  and subtract them only when deciding availability.
- **Decision:** (b) (P5). `Ledger.auths` is an append-only list of decisions; `closingBalance` never looks at
  it; `activeHolds` is derived: approved and not yet referenced by a settlement entry.
- **Why:** a hold is a promise, not a movement of money. Keeping it out of the journal keeps P1 pure, keeps
  D2's closing at 250.00 with a 200.00 hold outstanding, and lets the hold's state be derived from facts
  (`holdState`) instead of stored and mutated.

## 13. Which balance an authorization is checked against

- **Ambiguity:** "ledger balance as of the booking day" could mean the booked-day balance, the value-dated
  balance, or the balance including same-day pending items.
- **Options:** (a) all entries regardless of value date; (b) entries with value date <= booking day; (c)
  (b) minus active holds.
- **Decision:** (c) (P5): `closingBalance(account, bookingDay) - activeHolds - newHold >= 0`.
  Auth-A on D2: 250.00 - 0 - 200.00 = 50.00, approved. Auth-B on D5: -335.00 - 0 - 90.00 = -425.00, declined.
- **Why:** value dating is what the rest of the ledger uses; ignoring it would let a back-valued debit
  (E7) be invisible to the D5 decision. Note that E7 is value-dated D2 <= D5 and so is counted in -335.00.

## 14. Capitalising when nothing accrued

- **Ambiguity:** "one credit entry per account" when the sum is zero.
- **Options:** (a) post a 0.00 credit; (b) post nothing.
- **Decision:** (b). Both accounts accrued more than zero here, so the branch never runs in the scenario.
- **Why:** a zero entry carries no information and `post` rejects non-positive amounts by design; the rule
  "one credit per account" is meant for accounts that have something to capitalise.

## 15. End of day for days without events, and the last day

- **Ambiguity:** P2 defines EOD for day D by "the stream first reaches a later day". A day with no events, or
  a stream that ends before Day 6, has no such trigger.
- **Options:** (a) close only days that had events; (b) close every day of the window in order.
- **Decision:** (b). `apply` closes every day between the current day and the event's booked day; `finish`
  closes every remaining day up to Day 6, then capitalises.
- **Why:** a statement period has a closing balance for every calendar day, events or not. In this scenario
  every day has events, so (a) and (b) coincide, but (b) is the one that stays right when they do not.

## 16. Late-event notice: which day does it belong to?

- **Ambiguity:** E10 is booked D5 and arrives during D6. Is the LATE_EVENT a D5 or a D6 notice?
- **Options:** (a) the booked day; (b) the day the stream was in when it arrived.
- **Decision:** (b): D6, matching the brief's "D6 LATE_EVENT (E10)". The entries themselves keep value date
  D5.
- **Why:** a notice records when the bank found out; the value date records when the money counts. They are
  different facts and the ledger keeps both.

## 17. A reversal of an entry that does not exist

- **Ambiguity:** what if `reverses` points at an unknown id?
- **Options:** (a) raise a notice and continue; (b) stop with an error.
- **Decision:** (b): `reverse` throws. It cannot happen with the given stream.
- **Why:** an unmatched settlement is a business exception (the money is real); a reversal of nothing is a
  data-integrity error, and continuing would silently drop a correction.

## 18. The word "interest" at an Islamic bank

- **Ambiguity:** the brief calls the daily accrual "interest". Mal is an Islamic bank.
- **Options:** (a) rename the concept in code and output; (b) keep the brief's term.
- **Decision:** (b). Code, tests and reports use the brief's wording so that every expected result reads the
  same as the specification.
- **Why:** the naming is a product and Sharia-board decision, not a ledger-engine decision; the arithmetic
  (a daily accrual, memo-recorded, capitalised once) is unchanged by the label, and the rename is a one-word
  change in `EntryKind` and the report.
