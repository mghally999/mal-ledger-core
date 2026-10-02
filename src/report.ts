/**
 * Plain-text report of a finished replay: one block per day (closing balances, fees, authorization
 * activity, notices, interest accrued), then capitalisation, final balances, final auth states and
 * the full journal. Presentation only: nothing in here changes state.
 */
import { format } from './money.ts';
import type { AccountId, Entry, Ledger } from './ledger.ts';
import { FIRST_DAY, LAST_DAY, type Replay } from './replay.ts';

export function report(run: Replay): string {
  const { ledger } = run;
  const money = (account: AccountId, amount: bigint): string =>
    `${ledger.currencyOf(account)} ${format(amount, ledger.currencyOf(account))}`;
  const lines: string[] = [];
  /** One labelled row. Several items continue on indented lines; no items prints "none". */
  const row = (label: string, items: string[]): void => {
    lines.push(`  ${label.padEnd(10)}${items.length === 0 ? 'none' : items.join(`\n${' '.repeat(12)}`)}`);
  };

  lines.push(`Mal ledger replay, Day ${FIRST_DAY} to Day ${LAST_DAY} (events applied in the order given)`);
  for (let day = FIRST_DAY; day <= LAST_DAY; day += 1) {
    const eod = run.eodLog.filter((r) => r.day === day);
    lines.push('', `Day ${day}`);
    row('closing', eod.map((r) => `${r.account} ${money(r.account, r.closing)}`));
    row('fees', ledger.entries.filter((e) => e.kind === 'FEE' && e.bookedDay === day)
      .map((e) => `${e.id} ${e.account} ${money(e.account, e.amount)} (value date D${e.valueDay})`));
    row('auths', authActivity(ledger, day));
    row('notices', run.notices.filter((n) => n.day === day).map((n) => `${n.code} ${n.ref}: ${n.detail}`));
    row('interest', eod.map((r) => `${r.account} ${money(r.account, r.accrual)}`));
  }

  lines.push('', `Capitalised interest (value date D${LAST_DAY}; one credit per account = exact sum of its daily accruals)`);
  for (const account of ledger.accounts.keys()) {
    const accruals = run.eodLog.filter((r) => r.account === account).map((r) => r.accrual);
    const total = accruals.reduce((sum, a) => sum + a, 0n);
    lines.push(`  ${account} ${money(account, total)} = ${accruals.map((a) => format(a, ledger.currencyOf(account))).join(' + ')}`);
  }

  lines.push('', 'Final balances');
  for (const account of ledger.accounts.keys()) {
    lines.push(`  ${account} ${money(account, ledger.closingBalance(account, LAST_DAY))}`);
  }

  lines.push('', 'Authorizations (final state)');
  for (const auth of ledger.auths) {
    lines.push(`  ${auth.id} ${ledger.holdState(auth)} (requested D${auth.day}, hold ${money(auth.account, auth.amount)})`);
  }

  lines.push('', 'Journal (append-only, in posting order)');
  for (const entry of ledger.entries) lines.push(`  ${describe(ledger, entry)}`);
  return lines.join('\n');
}

/** "E5  DEBIT  ACC-001 AED 185.00  booked D4 vd D4  settles Auth-A" */
function describe(ledger: Ledger, entry: Entry): string {
  const currency = ledger.currencyOf(entry.account);
  const note = {
    TRANSFER: entry.valueDay < entry.bookedDay ? 'back-valued' : '',
    SETTLEMENT: `settles ${entry.authId}`,
    REVERSAL: `reverses ${entry.reversesId}`,
    FEE: 'overdraft fee',
    INTEREST: 'capitalised interest',
  }[entry.kind];
  return `${entry.id.padEnd(14)} ${entry.side.padEnd(6)} ${entry.account} ${currency} ${format(entry.amount, currency).padStart(8)}`
    + `  booked D${entry.bookedDay} vd D${entry.valueDay}  ${note}`.trimEnd();
}

/** Authorization decisions taken on `day` and settlements booked on `day`. */
function authActivity(ledger: Ledger, day: number): string[] {
  const money = (account: AccountId, amount: bigint): string => format(amount, ledger.currencyOf(account));
  const lines: string[] = [];
  for (const auth of ledger.auths) {
    if (auth.day !== day) continue;
    const outcome = auth.decision === 'APPROVED' ? 'available after hold' : 'available would be';
    lines.push(`${auth.id} ${auth.decision} hold ${money(auth.account, auth.amount)} (${outcome} ${money(auth.account, auth.available)})`);
  }
  for (const entry of ledger.entries) {
    if (entry.kind !== 'SETTLEMENT' || entry.bookedDay !== day || entry.authId === undefined) continue;
    const auth = ledger.findAuth(entry.authId);
    const matched = auth !== undefined && auth.decision === 'APPROVED' && auth.account === entry.account;
    lines.push(matched
      ? `${auth.id} SETTLED ${money(entry.account, entry.amount)}; hold ${money(entry.account, auth.amount)} released (${money(entry.account, auth.amount - entry.amount)} unused)`
      : `${entry.authId} UNMATCHED settlement ${money(entry.account, entry.amount)} force-posted`);
  }
  return lines;
}
