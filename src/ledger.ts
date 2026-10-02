/**
 * The ledger: an append-only journal of entries plus an append-only list of authorization decisions.
 *
 * Nothing in here is ever edited or deleted. Corrections are new entries (reversals, fees),
 * and every derived figure (balances, active holds, hold states) is recomputed from the records.
 */
import type { Currency } from './money.ts';

/** Days are plain integers inside the replay window (Day 1 .. Day 6). */
export type Day = number;
export type AccountId = string;
export type Side = 'CREDIT' | 'DEBIT';

/** Why an entry exists. Everything that moves a balance is an entry: fees, reversals and interest included. */
export type EntryKind = 'TRANSFER' | 'SETTLEMENT' | 'FEE' | 'REVERSAL' | 'INTEREST';

export interface Entry {
  readonly id: string;
  readonly account: AccountId;
  readonly side: Side;
  readonly amount: bigint; // minor units, always > 0; `side` carries the direction
  readonly bookedDay: Day; // the day the entry entered the ledger
  readonly valueDay: Day; // the day it counts for balances (P1); may be earlier than bookedDay
  readonly kind: EntryKind;
  readonly authId?: string; // SETTLEMENT only: the authorization it settles (matched or not)
  readonly reversesId?: string; // REVERSAL only: the entry being reversed (P8)
}

/** An authorization decision. Holds live here, never in `entries`: they do not move the ledger balance (P5). */
export interface Auth {
  readonly id: string; // "Auth-A"
  readonly account: AccountId;
  readonly amount: bigint; // the hold, in minor units
  readonly day: Day; // booking day of the request
  readonly available: bigint; // balance as of `day` - holds already active - this hold, at decision time
  readonly decision: 'APPROVED' | 'DECLINED';
}

export type HoldState = 'ACTIVE' | 'SETTLED' | 'DECLINED';

export class Ledger {
  /** The journal. Append-only: entries are frozen and only ever pushed, never edited or removed. */
  readonly entries: Entry[] = [];
  /** Authorization decisions, also frozen and append-only. */
  readonly auths: Auth[] = [];
  /** Account -> currency. Opening balances are zero, so no opening entries are needed. */
  readonly accounts: ReadonlyMap<AccountId, Currency>;

  constructor(accounts: Readonly<Record<AccountId, Currency>>) {
    this.accounts = new Map(Object.entries(accounts));
  }

  currencyOf(account: AccountId): Currency {
    const currency = this.accounts.get(account);
    if (currency === undefined) throw new Error(`unknown account ${account}`);
    return currency;
  }

  /** Append one entry. This is the only way the journal ever changes. */
  post(entry: Entry): Entry {
    this.currencyOf(entry.account); // rejects unknown accounts
    if (entry.amount <= 0n) throw new RangeError(`entry ${entry.id}: amount must be > 0 (side gives the direction)`);
    if (this.find(entry.id) !== undefined) throw new Error(`entry ${entry.id} already exists`);
    const frozen: Entry = Object.freeze({ ...entry });
    this.entries.push(frozen);
    return frozen;
  }

  find(id: string): Entry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  /** P1: closing ledger balance for `day` = sum of the entries booked SO FAR whose value date is <= day. */
  closingBalance(account: AccountId, day: Day): bigint {
    let balance = 0n;
    for (const entry of this.entries) {
      if (entry.account !== account || entry.valueDay > day) continue;
      balance += entry.side === 'CREDIT' ? entry.amount : -entry.amount;
    }
    return balance;
  }

  /** P5: approve only if the balance as of `day`, minus holds already active, minus this hold, stays >= 0. */
  authorize(id: string, account: AccountId, amount: bigint, day: Day): Auth {
    this.currencyOf(account); // rejects unknown accounts
    if (this.findAuth(id) !== undefined) throw new Error(`authorization ${id} already exists`);
    const available = this.closingBalance(account, day) - this.activeHolds(account) - amount;
    const auth: Auth = Object.freeze({
      id, account, amount, day, available,
      decision: available >= 0n ? 'APPROVED' : 'DECLINED',
    });
    this.auths.push(auth);
    return auth;
  }

  findAuth(id: string): Auth | undefined {
    return this.auths.find((auth) => auth.id === id);
  }

  /** Derived, never stored: an approved hold stays ACTIVE until a settlement entry references it (P6). */
  holdState(auth: Auth): HoldState {
    if (auth.decision === 'DECLINED') return 'DECLINED';
    return this.entries.some((entry) => entry.authId === auth.id) ? 'SETTLED' : 'ACTIVE';
  }

  /** Sum of the ACTIVE holds on an account. Holds reduce availability but never the ledger balance (P5). */
  activeHolds(account: AccountId): bigint {
    let total = 0n;
    for (const auth of this.auths) {
      if (auth.account === account && this.holdState(auth) === 'ACTIVE') total += auth.amount;
    }
    return total;
  }
}
