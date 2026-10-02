/**
 * Money = integers in MINOR units, held as `bigint`. Never a float.
 *
 *   AED has 2 decimal places: 1 AED = 100 fils   -> "1200.00" is 120000n
 *   BHD has 3 decimal places: 1 BHD = 1000 fils  -> "10.000"  is 10000n
 *
 * Every calculation in this project is integer arithmetic on these values.
 * An amount only becomes a string with a decimal point at print time (`format`).
 */

export type Currency = 'AED' | 'BHD';

/** Minor-unit decimal places per currency (ISO 4217: AED 2, BHD 3). */
export const DECIMALS: Readonly<Record<Currency, number>> = { AED: 2, BHD: 3 };

/**
 * Parse a decimal string into minor units: toMinor("1200.00", "AED") -> 120000n.
 * The text must carry exactly the currency's number of decimals, so a typo like
 * "10.00" for BHD (which would be 10.000 or 1.000?) is rejected instead of guessed.
 */
export function toMinor(text: string, currency: Currency): bigint {
  const decimals = DECIMALS[currency];
  const match = /^(-?)(\d+)\.(\d+)$/.exec(text);
  if (match === null || match[3].length !== decimals) {
    throw new RangeError(`"${text}" is not a ${currency} amount with ${decimals} decimals`);
  }
  const [, sign, whole, fraction] = match;
  const minor = BigInt(whole + fraction); // digits only, so no floating point is ever involved
  return sign === '-' ? -minor : minor;
}

/**
 * Print minor units as a decimal string: format(-37000n, "AED") -> "-370.00", format(4n, "BHD") -> "0.004".
 * Only used for output; the bigint stays the source of truth.
 */
export function format(minor: bigint, currency: Currency): string {
  const decimals = DECIMALS[currency];
  const sign = minor < 0n ? '-' : '';
  const magnitude = minor < 0n ? -minor : minor;
  // Pad so there is always at least one digit before the decimal point: 5n -> "005" -> "0.05".
  const digits = magnitude.toString().padStart(decimals + 1, '0');
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/**
 * round_half_up(numerator / denominator) in pure integer arithmetic.
 * A fraction of exactly one half rounds UP (11.5 -> 12); anything below rounds down (11.4 -> 11).
 * Defined for numerator >= 0 only: interest is accrued on positive balances alone (P4),
 * so the sign question for "half up" on negatives never arises here.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError('roundHalfUp expects numerator >= 0 and denominator > 0');
  }
  const quotient = numerator / denominator; // bigint division drops the fraction
  const remainder = numerator % denominator; // the dropped fraction, still scaled by denominator
  return remainder * 2n >= denominator ? quotient + 1n : quotient; // fraction >= 1/2 -> round up
}

/**
 * Split a total into `count` instalments that sum EXACTLY to the total (P9).
 * Integer division gives the even share; the leftover minor units go to the FIRST instalment.
 *   splitInstalments(10000n, 3) -> [3334n, 3333n, 3333n]   (BHD 10.000 -> 3.334 + 3.333 + 3.333)
 */
export function splitInstalments(total: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('instalment count must be a positive integer');
  }
  const share = total / BigInt(count);
  const remainder = total - share * BigInt(count); // 0 .. count-1 minor units
  const parts = new Array<bigint>(count).fill(share);
  parts[0] = share + remainder;
  return parts;
}
