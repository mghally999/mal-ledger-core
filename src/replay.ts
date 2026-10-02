/**
 * The replay engine: feeds events to the ledger in the exact order given (never sorted),
 * runs end-of-day (EOD) processing when the stream moves to a later day, and capitalises
 * interest once after the last day. Policies P2 .. P10 live here; P1, P5 and P6 live in the ledger.
 */
import { format, roundHalfUp, splitInstalments, type Currency } from './money.ts';
import { Ledger, type AccountId, type Day } from './ledger.ts';

export const FIRST_DAY: Day = 1;
export const LAST_DAY: Day = 6;
/** P3: the overdraft fee, AED 25.00 = 2500 fils. Defined in AED only. */
export const OVERDRAFT_FEE = 2500n;
/** P4: daily interest = closing * 4 / 10000 (0.04% per day), rounded half up. */
export const RATE_NUMERATOR = 4n;
export const RATE_DENOMINATOR = 10000n;

interface EventBase {
  readonly id: string; // "E1" .. "E10"
  readonly booked: Day; // the day the event was booked; drives EOD (P2) and late detection (P10)
}
/** A plain credit or debit. `instalments` splits the amount into N entries (P9). */
export interface TransferEvent extends EventBase {
  readonly type: 'CREDIT' | 'DEBIT';
  readonly account: AccountId;
  readonly amount: bigint;
  readonly valueDay: Day;
  readonly instalments?: number;
}
/** An authorization request. No value date: a hold is not a ledger entry (P5). */
export interface AuthEvent extends EventBase {
  readonly type: 'AUTH';
  readonly account: AccountId;
  readonly authId: string;
  readonly amount: bigint;
}
/** A card settlement, matched to an authorization by id (P6) or force-posted without one (P7). */
export interface SettleEvent extends EventBase {
  readonly type: 'SETTLE';
  readonly account: AccountId;
  readonly authId: string;
  readonly amount: bigint;
  readonly valueDay: Day;
}
/** A reversal of an earlier entry. Account, amount and value date all come from the original (P8). */
export interface ReversalEvent extends EventBase {
  readonly type: 'REVERSAL';
  readonly reverses: string; // id of the entry being reversed
}
export type Event = TransferEvent | AuthEvent | SettleEvent | ReversalEvent;

export type NoticeCode = 'UNMATCHED_SETTLEMENT' | 'AUTH_DECLINED' | 'LATE_EVENT' | 'FEE_SKIPPED_NON_AED';

/** An error/exception raised during the replay, for human review. Notices never change the ledger. */
export interface Notice {
  readonly day: Day; // the day the stream was in when it was raised
  readonly code: NoticeCode;
  readonly ref: string; // what it is about: an event id, an auth id or an account
  readonly detail: string;
}

/** The EOD memo for one account on one day. `accrual` is the P4 interest memo: NOT a ledger entry, never restated. */
export interface EodRecord {
  readonly day: Day;
  readonly account: AccountId;
  readonly closing: bigint; // closing balance after the fee check
  readonly accrual: bigint; // rounded daily interest; 0 when closing <= 0
}

export class Replay {
  readonly ledger: Ledger;
  readonly eodLog: EodRecord[] = [];
  readonly notices: Notice[] = [];
  /** The booking day the stream is currently in (P2). */
  private day: Day = FIRST_DAY;
  /** Days whose EOD has run. Makes EOD idempotent (P3) and detects late events (P10). */
  private readonly closedDays = new Set<Day>();

  constructor(ledger: Ledger) {
    this.ledger = ledger;
  }

  /** Feed the next event. Events are applied in the order given; the stream is never sorted. */
  apply(event: Event): void {
    // P2: reaching an event booked on a LATER day first closes every day before it, oldest first.
    while (this.day < event.booked) {
      this.endOfDay(this.day);
      this.day += 1;
    }
    // P10: an event for a day that already closed is posted as-is and flagged; that day's EOD is NOT re-run.
    if (this.closedDays.has(event.booked)) {
      this.notice('LATE_EVENT', event.id, `booked D${event.booked} but arrived during D${this.day}; posted as-is, D${event.booked} EOD not re-run`);
    }
    switch (event.type) {
      case 'CREDIT':
      case 'DEBIT':
        this.transfer(event);
        break;
      case 'AUTH':
        this.authorize(event);
        break;
      case 'SETTLE':
        this.settle(event);
        break;
      case 'REVERSAL':
        this.reverse(event);
        break;
    }
  }

  /** Call once after the last event: closes the remaining days through LAST_DAY (P2), then capitalises (P4). */
  finish(): void {
    while (this.day <= LAST_DAY) {
      this.endOfDay(this.day);
      this.day += 1;
    }
    for (const account of this.ledger.accounts.keys()) this.capitalise(account);
  }

  /** P2: end of day D for every account: (a) overdraft fee check, then (b) interest accrual. Idempotent. */
  endOfDay(day: Day): void {
    if (this.closedDays.has(day)) return; // at most once per day (P3)
    this.closedDays.add(day);
    for (const [account, currency] of this.ledger.accounts) {
      this.chargeOverdraftFee(account, currency, day);
      const closing = this.ledger.closingBalance(account, day); // after the fee, per the (a)-then-(b) order
      // P4: interest on positive balances only. The memo is written once and never restated.
      const accrual = closing > 0n ? roundHalfUp(closing * RATE_NUMERATOR, RATE_DENOMINATOR) : 0n;
      this.eodLog.push(Object.freeze({ day, account, closing, accrual }));
    }
  }

  // ---- event handlers ---------------------------------------------------------------------

  private transfer(event: TransferEvent): void {
    // P9: an instalment credit becomes N entries whose amounts sum exactly to the total.
    const parts = splitInstalments(event.amount, event.instalments ?? 1);
    parts.forEach((amount, index) => {
      this.ledger.post({
        id: parts.length === 1 ? event.id : `${event.id}-${index + 1}`,
        account: event.account, side: event.type, amount,
        bookedDay: event.booked, valueDay: event.valueDay, kind: 'TRANSFER',
      });
    });
  }

  private authorize(event: AuthEvent): void {
    const auth = this.ledger.authorize(event.authId, event.account, event.amount, event.booked);
    if (auth.decision === 'DECLINED') {
      this.notice('AUTH_DECLINED', auth.id, `available would be ${this.money(auth.account, auth.available)}`);
    }
  }

  private settle(event: SettleEvent): void {
    const auth = this.ledger.findAuth(event.authId);
    const matched = auth !== undefined && auth.account === event.account && this.ledger.holdState(auth) === 'ACTIVE';
    // P6/P7: the debit is posted either way. Referencing the auth id is what releases a matched hold.
    this.ledger.post({
      id: event.id, account: event.account, side: 'DEBIT', amount: event.amount,
      bookedDay: event.booked, valueDay: event.valueDay, kind: 'SETTLEMENT', authId: event.authId,
    });
    if (!matched) {
      // P7: card schemes do not let an issuer refuse cleared funds: accept it, flag it for review/chargeback.
      this.notice('UNMATCHED_SETTLEMENT', event.authId, `no active authorization; ${this.money(event.account, event.amount)} force-posted for review/chargeback`);
    }
  }

  private reverse(event: ReversalEvent): void {
    const original = this.ledger.find(event.reverses);
    if (original === undefined) throw new Error(`${event.id}: cannot reverse unknown entry ${event.reverses}`);
    // P8: a NEW entry on the opposite side with the ORIGINAL value date. The original stays untouched,
    // and nothing the original caused (such as a fee) is undone automatically.
    this.ledger.post({
      id: event.id, account: original.account, side: original.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amount: original.amount, bookedDay: event.booked, valueDay: original.valueDay,
      kind: 'REVERSAL', reversesId: original.id,
    });
  }

  // ---- end-of-day pieces ------------------------------------------------------------------

  /** P3: AED 25.00 when the day closes negative. Once per account per day, never for earlier days. */
  private chargeOverdraftFee(account: AccountId, currency: Currency, day: Day): void {
    if (this.ledger.closingBalance(account, day) >= 0n) return;
    if (currency !== 'AED') {
      // The fee is defined in AED and no FX rate is given, so it cannot be assessed here (see AMBIGUITIES.md).
      this.notice('FEE_SKIPPED_NON_AED', account, `closed D${day} negative but the overdraft fee is AED-only`, day);
      return;
    }
    this.ledger.post({
      id: `FEE-${account}-D${day}`, account, side: 'DEBIT', amount: OVERDRAFT_FEE,
      bookedDay: day, valueDay: day, kind: 'FEE',
    });
  }

  /** P4: after the last EOD, ONE credit per account equal to the exact sum of its rounded daily accruals. */
  private capitalise(account: AccountId): void {
    let total = 0n;
    for (const record of this.eodLog) if (record.account === account) total += record.accrual;
    if (total === 0n) return; // nothing accrued: no empty entry
    this.ledger.post({
      id: `INT-${account}-D${LAST_DAY}`, account, side: 'CREDIT', amount: total,
      bookedDay: LAST_DAY, valueDay: LAST_DAY, kind: 'INTEREST',
    });
  }

  // ---- helpers ----------------------------------------------------------------------------

  private notice(code: NoticeCode, ref: string, detail: string, day: Day = this.day): void {
    this.notices.push(Object.freeze({ day, code, ref, detail }));
  }

  private money(account: AccountId, amount: bigint): string {
    const currency = this.ledger.currencyOf(account);
    return `${currency} ${format(amount, currency)}`;
  }
}

/** Replay a whole stream from scratch and return the finished run. */
export function runReplay(accounts: Readonly<Record<AccountId, Currency>>, events: readonly Event[]): Replay {
  const run = new Replay(new Ledger(accounts));
  for (const event of events) run.apply(event);
  run.finish();
  return run;
}
