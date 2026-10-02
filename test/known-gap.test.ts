/**
 * KNOWN GAP: this test is EXPECTED TO FAIL. Run it with `npm run test:gap`; `npm test` excludes it on purpose.
 *
 * It asserts what ACC-001's capitalised interest WOULD be (0.79) under a different design in which
 *   1. back-valued corrections RESTATE past accruals: E7 (DEBIT 620.00, booked D5, value date D2) and its
 *      reversal E9 (booked D6, value date D2) net to zero on every day, so D5 would be re-accrued on 285.00; and
 *   2. the overdraft fee that E7 caused on D5 is refunded once E7 is reversed, so D5 and D6 close at 285.00.
 * Daily accruals under that design: 0.10 + 0.10 + 0.26 + 0.11 + 0.11 + 0.11 = 0.79.
 *
 * This ledger produces 0.67 (0.10 + 0.10 + 0.26 + 0.11 + 0.00 + 0.10), on purpose:
 *   - P4: accruals are memo records written once at EOD and never restated. D5 accrued 0.00 on a close of
 *     -360.00; the reversal booked on D6 does not reopen Day 5.
 *   - P3 / P8: fees are never refunded automatically. The 25.00 fee stays, so D6 closes at 260.00 (not 285.00)
 *     and accrues 0.10 (not 0.11).
 * The 0.12 difference is the price of an append-only ledger that never restates the past. It is a documented
 * design decision (AMBIGUITIES.md, REJECTED.md), not a bug to fix: restating would make yesterday's reported
 * numbers change after the fact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from '../src/money.ts';
import { runReplay } from '../src/replay.ts';
import { ACCOUNTS, EVENTS } from '../src/scenario.ts';

test('KNOWN GAP (fails by design): ACC-001 capitalised interest would be 0.79 if past accruals were restated and the fee refunded', () => {
  const run = runReplay(ACCOUNTS, EVENTS);
  const capitalised = run.ledger.entries.find((e) => e.kind === 'INTEREST' && e.account === 'ACC-001')!;
  // Actual value: 0.67. The assertion below fails on purpose; see the comment at the top of this file.
  assert.equal(format(capitalised.amount, 'AED'), '0.79');
});
