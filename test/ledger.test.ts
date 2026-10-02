import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, type Entry, type Side } from '../src/ledger.ts';

const ACCOUNTS = { 'ACC-001': 'AED', 'ACC-002': 'BHD' } as const;

/** Small builder so the tests read like the event stream: credit('E1', 120000n, 1) = booked D1, value D1. */
function entry(side: Side, id: string, amount: bigint, bookedDay: number, valueDay = bookedDay): Entry {
  return { id, account: 'ACC-001', side, amount, bookedDay, valueDay, kind: 'TRANSFER' };
}
const credit = (id: string, amount: bigint, booked: number, value?: number) => entry('CREDIT', id, amount, booked, value);
const debit = (id: string, amount: bigint, booked: number, value?: number) => entry('DEBIT', id, amount, booked, value);

test('post appends a frozen copy of the entry and returns it', () => {
  const ledger = new Ledger(ACCOUNTS);
  const posted = ledger.post(credit('E1', 120000n, 1));
  assert.ok(Object.isFrozen(posted));
  assert.deepEqual(ledger.entries, [posted]);
  // ES modules run in strict mode, so writing to a frozen object throws instead of silently failing.
  assert.throws(() => { (posted as { amount: bigint }).amount = 1n; }, TypeError);
  assert.equal(posted.amount, 120000n);
});

test('post rejects unknown accounts, non-positive amounts and duplicate ids', () => {
  const ledger = new Ledger(ACCOUNTS);
  assert.throws(() => ledger.post({ ...credit('X', 100n, 1), account: 'ACC-999' }), /unknown account/);
  assert.throws(() => ledger.post(credit('X', 0n, 1)), RangeError);
  assert.throws(() => ledger.post(credit('X', -100n, 1)), RangeError);
  ledger.post(credit('E1', 100n, 1));
  assert.throws(() => ledger.post(credit('E1', 100n, 1)), /already exists/);
  assert.equal(ledger.entries.length, 1);
});

test('closingBalance for day D sums entries booked so far with value date <= D (P1)', () => {
  const ledger = new Ledger(ACCOUNTS);
  ledger.post(credit('E1', 120000n, 1));
  ledger.post(debit('E2', 95000n, 1));
  ledger.post(credit('E4', 40000n, 3));
  assert.equal(ledger.closingBalance('ACC-001', 1), 25000n);
  assert.equal(ledger.closingBalance('ACC-001', 2), 25000n); // E4 is value-dated D3: not yet
  assert.equal(ledger.closingBalance('ACC-001', 3), 65000n);
  assert.equal(ledger.closingBalance('ACC-002', 3), 0n); // other account untouched
});

test('a back-valued entry changes earlier closing balances from the moment it is booked', () => {
  const ledger = new Ledger(ACCOUNTS);
  ledger.post(credit('E1', 120000n, 1));
  ledger.post(debit('E2', 95000n, 1));
  ledger.post(debit('E7', 62000n, 5, 2)); // booked D5, value date D2
  assert.equal(ledger.closingBalance('ACC-001', 1), 25000n); // D1 is before the value date
  assert.equal(ledger.closingBalance('ACC-001', 2), -37000n); // D2 onwards sees it
  assert.equal(ledger.closingBalance('ACC-001', 5), -37000n);
});

test('authorize approves when balance as of the day minus active holds covers the new hold (P5)', () => {
  const ledger = new Ledger(ACCOUNTS);
  ledger.post(credit('E1', 25000n, 1));
  const a = ledger.authorize('Auth-A', 'ACC-001', 20000n, 2);
  assert.equal(a.decision, 'APPROVED');
  assert.equal(a.available, 5000n);
  assert.ok(Object.isFrozen(a));
  assert.equal(ledger.holdState(a), 'ACTIVE');
  assert.equal(ledger.activeHolds('ACC-001'), 20000n);
  assert.equal(ledger.closingBalance('ACC-001', 2), 25000n); // holds never touch the ledger balance
  assert.equal(ledger.entries.length, 1); // and never create entries
});

test('authorize declines when the hold would push availability below zero, and a declined hold holds nothing', () => {
  const ledger = new Ledger(ACCOUNTS);
  ledger.post(credit('E1', 25000n, 1));
  ledger.authorize('Auth-A', 'ACC-001', 20000n, 2);
  const b = ledger.authorize('Auth-B', 'ACC-001', 6000n, 2); // 25000 - 20000 - 6000 = -1000
  assert.equal(b.decision, 'DECLINED');
  assert.equal(b.available, -1000n);
  assert.equal(ledger.holdState(b), 'DECLINED');
  assert.equal(ledger.activeHolds('ACC-001'), 20000n); // only Auth-A is held
});

test('authorize uses the balance as of the booking day: a credit value-dated later does not count', () => {
  const ledger = new Ledger(ACCOUNTS);
  ledger.post(credit('E1', 10000n, 1, 3)); // booked D1 but value-dated D3
  assert.equal(ledger.authorize('Auth-A', 'ACC-001', 5000n, 2).decision, 'DECLINED');
  assert.equal(ledger.authorize('Auth-B', 'ACC-001', 5000n, 3).decision, 'APPROVED');
});

test('a settlement entry referencing the auth releases the whole hold (P6)', () => {
  const ledger = new Ledger(ACCOUNTS);
  ledger.post(credit('E1', 25000n, 1));
  const a = ledger.authorize('Auth-A', 'ACC-001', 20000n, 2);
  ledger.post({ ...debit('E5', 18500n, 4), kind: 'SETTLEMENT', authId: 'Auth-A' });
  assert.equal(ledger.holdState(a), 'SETTLED');
  assert.equal(ledger.activeHolds('ACC-001'), 0n); // the unused 15.00 is released, not kept
  assert.equal(ledger.closingBalance('ACC-001', 4), 6500n); // only the settled 185.00 was debited
});

test('authorize rejects unknown accounts and duplicate ids', () => {
  const ledger = new Ledger(ACCOUNTS);
  assert.throws(() => ledger.authorize('Auth-A', 'ACC-999', 1n, 1), /unknown account/);
  ledger.authorize('Auth-A', 'ACC-001', 1n, 1);
  assert.throws(() => ledger.authorize('Auth-A', 'ACC-001', 1n, 1), /already exists/);
});
