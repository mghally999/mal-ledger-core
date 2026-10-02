/**
 * The EXPECTED RESULTS of the brief, asserted one by one against a full replay of the event stream.
 * Amounts are compared as formatted strings ("-370.00") so each assertion reads exactly like the brief.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from '../src/money.ts';
import { Ledger } from '../src/ledger.ts';
import { Replay, runReplay, type EodRecord } from '../src/replay.ts';
import { ACCOUNTS, EVENTS } from '../src/scenario.ts';

const aed = (minor: bigint): string => format(minor, 'AED');
const bhd = (minor: bigint): string => format(minor, 'BHD');
const DAYS = [1, 2, 3, 4, 5, 6];

/** One full run shared by the tests below. Nothing mutates it: every assertion reads frozen records. */
const run = runReplay(ACCOUNTS, EVENTS);
const { ledger } = run;
const eod = (account: string, day: number): EodRecord => run.eodLog.find((r) => r.account === account && r.day === day)!;

test('after replaying through E8 (before Day 5 EOD): closingBalance(ACC-001, D2) = -370.00', () => {
  const partial = new Replay(new Ledger(ACCOUNTS));
  for (const event of EVENTS.slice(0, 8)) partial.apply(event); // E1 .. E8
  assert.equal(aed(partial.ledger.closingBalance('ACC-001', 2)), '-370.00'); // 250.00 - 620.00 back-valued to D2
  assert.equal(partial.ledger.entries.filter((e) => e.kind === 'FEE').length, 0); // Day 5 EOD has not run yet
});

test('Auth-A: APPROVED on D2 (available after hold 50.00); SETTLED D4 for 185.00, 15.00 released', () => {
  const authA = ledger.findAuth('Auth-A')!;
  assert.equal(authA.decision, 'APPROVED');
  assert.equal(authA.day, 2);
  assert.equal(aed(authA.available), '50.00');
  const e5 = ledger.find('E5')!;
  assert.equal(e5.kind, 'SETTLEMENT');
  assert.equal(e5.side, 'DEBIT');
  assert.equal(aed(e5.amount), '185.00');
  assert.equal(e5.valueDay, 4);
  assert.equal(e5.authId, 'Auth-A');
  assert.equal(ledger.holdState(authA), 'SETTLED');
  assert.equal(aed(authA.amount - e5.amount), '15.00'); // the unused part of the hold ...
  assert.equal(ledger.activeHolds('ACC-001'), 0n); // ... is released, not kept
});

test('Auth-Z: UNMATCHED_SETTLEMENT force-posted 180.00 on D4', () => {
  assert.equal(ledger.findAuth('Auth-Z'), undefined); // no prior auth exists
  const e6 = ledger.find('E6')!;
  assert.equal(e6.side, 'DEBIT');
  assert.equal(aed(e6.amount), '180.00');
  assert.equal(e6.bookedDay, 4);
  assert.equal(e6.valueDay, 4);
  const notice = run.notices.find((n) => n.code === 'UNMATCHED_SETTLEMENT')!;
  assert.equal(notice.day, 4);
  assert.equal(notice.ref, 'Auth-Z');
});

test('Auth-B: DECLINED on D5 (available would be -425.00) and holds nothing', () => {
  const authB = ledger.findAuth('Auth-B')!;
  assert.equal(authB.decision, 'DECLINED');
  assert.equal(authB.day, 5);
  assert.equal(aed(authB.available), '-425.00'); // -335.00 balance as of D5, no active holds, minus 90.00
  assert.equal(ledger.holdState(authB), 'DECLINED');
});

test('ACC-001 EOD closings: D1 250.00, D2 250.00, D3 650.00, D4 285.00, D5 -360.00, D6 260.00', () => {
  const closings = DAYS.map((day) => aed(eod('ACC-001', day).closing));
  assert.deepEqual(closings, ['250.00', '250.00', '650.00', '285.00', '-360.00', '260.00']);
});

test('ACC-001 D5 = -335.00 then fee 25.00 = -360.00; D6 260.00 before capitalisation, 260.67 after', () => {
  const fee = ledger.find('FEE-ACC-001-D5')!;
  assert.equal(aed(eod('ACC-001', 5).closing + fee.amount), '-335.00');
  assert.equal(aed(eod('ACC-001', 6).closing), '260.00');
  assert.equal(aed(ledger.closingBalance('ACC-001', 6)), '260.67');
});

test('exactly ONE fee in the whole run: AED 25.00, ACC-001, value_date D5', () => {
  const fees = ledger.entries.filter((e) => e.kind === 'FEE');
  assert.equal(fees.length, 1);
  const [fee] = fees;
  assert.equal(fee.account, 'ACC-001');
  assert.equal(fee.side, 'DEBIT');
  assert.equal(aed(fee.amount), '25.00');
  assert.equal(fee.valueDay, 5);
  assert.equal(fee.bookedDay, 5);
});

test('no retroactive fees: a back-valued debit makes D2..D4 negative, but their EOD already ran', () => {
  const fresh = new Replay(new Ledger(ACCOUNTS));
  for (const event of EVENTS.slice(0, 8)) fresh.apply(event); // E1 .. E8: D1..D4 are closed, D5 is open
  for (const day of [2, 3, 4]) assert.ok(fresh.ledger.closingBalance('ACC-001', day) < 0n); // negative since E7
  fresh.finish(); // closes D5 and D6; without E9 both close negative, so both get their own fee
  const feeDays = fresh.ledger.entries.filter((e) => e.kind === 'FEE').map((e) => e.valueDay);
  assert.deepEqual(feeDays, [5, 6]); // only days closed AFTER the debit arrived; never D2, D3 or D4
});

test('EOD is idempotent: running Day 5 again charges no second fee and writes no second memo', () => {
  const fresh = runReplay(ACCOUNTS, EVENTS);
  const before = { entries: fresh.ledger.entries.length, memos: fresh.eodLog.length };
  fresh.endOfDay(5);
  assert.equal(fresh.ledger.entries.length, before.entries);
  assert.equal(fresh.eodLog.length, before.memos);
});

test('ACC-001 daily accruals: 0.10, 0.10, 0.26, 0.11, 0.00, 0.10 -> capitalised 0.67', () => {
  const accruals = DAYS.map((day) => eod('ACC-001', day).accrual);
  assert.deepEqual(accruals.map(aed), ['0.10', '0.10', '0.26', '0.11', '0.00', '0.10']);
  const interest = ledger.entries.filter((e) => e.kind === 'INTEREST' && e.account === 'ACC-001');
  assert.equal(interest.length, 1); // ONE credit per account
  const [credit] = interest;
  assert.equal(credit.side, 'CREDIT');
  assert.equal(aed(credit.amount), '0.67');
  assert.equal(credit.valueDay, 6);
  assert.equal(credit.amount, accruals.reduce((sum, a) => sum + a, 0n)); // the EXACT sum of the rounded memos
});

test('accruals are memo records, not ledger entries', () => {
  assert.equal(run.eodLog.length, 12); // 6 days x 2 accounts
  // The journal: E1 E2 E4 E5 E6 E7 FEE E9 E10-1 E10-2 E10-3 INT INT. No daily accrual among them.
  assert.equal(ledger.entries.length, 13);
  assert.equal(ledger.entries.filter((e) => e.kind === 'INTEREST').length, 2);
});

test('ACC-002: instalments 3.334 + 3.333 + 3.333; D6 accrual 0.004; capitalised 0.004; final 10.004; no fees', () => {
  const parts = ['E10-1', 'E10-2', 'E10-3'].map((id) => ledger.find(id)!);
  assert.deepEqual(parts.map((e) => bhd(e.amount)), ['3.334', '3.333', '3.333']);
  assert.equal(bhd(parts.reduce((sum, e) => sum + e.amount, 0n)), '10.000');
  assert.ok(parts.every((e) => e.account === 'ACC-002' && e.side === 'CREDIT' && e.bookedDay === 5 && e.valueDay === 5));
  assert.equal(bhd(eod('ACC-002', 5).closing), '0.000'); // E10 arrived after Day 5 EOD, which is not re-run
  assert.deepEqual(DAYS.map((day) => bhd(eod('ACC-002', day).accrual)), ['0.000', '0.000', '0.000', '0.000', '0.000', '0.004']);
  const interest = ledger.entries.filter((e) => e.kind === 'INTEREST' && e.account === 'ACC-002');
  assert.equal(interest.length, 1);
  assert.equal(bhd(interest[0].amount), '0.004');
  assert.equal(bhd(ledger.closingBalance('ACC-002', 6)), '10.004');
  assert.equal(ledger.entries.filter((e) => e.kind === 'FEE' && e.account === 'ACC-002').length, 0);
});

test('errors/notices: D4 UNMATCHED_SETTLEMENT (Auth-Z), D5 AUTH_DECLINED (Auth-B), D6 LATE_EVENT (E10)', () => {
  assert.deepEqual(run.notices.map((n) => [n.day, n.code, n.ref]), [
    [4, 'UNMATCHED_SETTLEMENT', 'Auth-Z'],
    [5, 'AUTH_DECLINED', 'Auth-B'],
    [6, 'LATE_EVENT', 'E10'],
  ]);
  // The late event is visible in the journal too: its entries sit after E9 in posting order.
  const position = (id: string): number => ledger.entries.findIndex((e) => e.id === id);
  assert.ok(position('E10-1') > position('E9'));
});

test('reversal E9 is a new CREDIT 620.00 value-dated D2 and linked to E7; E7 itself is untouched', () => {
  const e9 = ledger.find('E9')!;
  assert.equal(e9.kind, 'REVERSAL');
  assert.equal(e9.side, 'CREDIT');
  assert.equal(aed(e9.amount), '620.00');
  assert.equal(e9.bookedDay, 6);
  assert.equal(e9.valueDay, 2);
  assert.equal(e9.reversesId, 'E7');
  assert.deepEqual(ledger.find('E7'), {
    id: 'E7', account: 'ACC-001', side: 'DEBIT', amount: 62000n, bookedDay: 5, valueDay: 2, kind: 'TRANSFER',
  });
});

test('everything recorded is frozen: entries, auths, EOD memos and notices', () => {
  assert.ok(ledger.entries.every((e) => Object.isFrozen(e)));
  assert.ok(ledger.auths.every((a) => Object.isFrozen(a)));
  assert.ok(run.eodLog.every((r) => Object.isFrozen(r)));
  assert.ok(run.notices.every((n) => Object.isFrozen(n)));
});
