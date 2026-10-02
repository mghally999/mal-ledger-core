/**
 * The brief's accounts and event stream, transcribed line by line.
 * The array order IS the stream order and is replayed exactly as written:
 * E10 (booked D5) really does arrive after E9 (booked D6).
 */
import { toMinor, type Currency } from './money.ts';
import type { AccountId } from './ledger.ts';
import type { Event } from './replay.ts';

/** ACC-001 is an AED account, ACC-002 a BHD account; both open at zero. */
export const ACCOUNTS: Readonly<Record<AccountId, Currency>> = { 'ACC-001': 'AED', 'ACC-002': 'BHD' };

const aed = (text: string): bigint => toMinor(text, 'AED');
const bhd = (text: string): bigint => toMinor(text, 'BHD');

export const EVENTS: readonly Event[] = [
  { id: 'E1', booked: 1, type: 'CREDIT', account: 'ACC-001', amount: aed('1200.00'), valueDay: 1 },
  { id: 'E2', booked: 1, type: 'DEBIT', account: 'ACC-001', amount: aed('950.00'), valueDay: 1 },
  { id: 'E3', booked: 2, type: 'AUTH', account: 'ACC-001', authId: 'Auth-A', amount: aed('200.00') },
  { id: 'E4', booked: 3, type: 'CREDIT', account: 'ACC-001', amount: aed('400.00'), valueDay: 3 },
  { id: 'E5', booked: 4, type: 'SETTLE', account: 'ACC-001', authId: 'Auth-A', amount: aed('185.00'), valueDay: 4 },
  { id: 'E6', booked: 4, type: 'SETTLE', account: 'ACC-001', authId: 'Auth-Z', amount: aed('180.00'), valueDay: 4 }, // no prior auth
  { id: 'E7', booked: 5, type: 'DEBIT', account: 'ACC-001', amount: aed('620.00'), valueDay: 2 }, // back-valued to D2
  { id: 'E8', booked: 5, type: 'AUTH', account: 'ACC-001', authId: 'Auth-B', amount: aed('90.00') },
  { id: 'E9', booked: 6, type: 'REVERSAL', reverses: 'E7' }, // value date D2 comes from E7 (P8)
  { id: 'E10', booked: 5, type: 'CREDIT', account: 'ACC-002', amount: bhd('10.000'), valueDay: 5, instalments: 3 }, // arrives after E9: late (P10)
];
