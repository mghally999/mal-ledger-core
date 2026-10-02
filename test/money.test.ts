import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECIMALS, format, roundHalfUp, splitInstalments, toMinor } from '../src/money.ts';

test('currencies carry their ISO 4217 minor-unit decimals', () => {
  assert.equal(DECIMALS.AED, 2);
  assert.equal(DECIMALS.BHD, 3);
});

test('toMinor parses decimal strings into bigint minor units', () => {
  assert.equal(toMinor('1200.00', 'AED'), 120000n);
  assert.equal(toMinor('0.05', 'AED'), 5n);
  assert.equal(toMinor('-370.00', 'AED'), -37000n);
  assert.equal(toMinor('10.000', 'BHD'), 10000n);
  assert.equal(toMinor('0.004', 'BHD'), 4n);
});

test('toMinor rejects text with the wrong number of decimals', () => {
  assert.throws(() => toMinor('10.00', 'BHD'), RangeError); // BHD needs 3 decimals
  assert.throws(() => toMinor('1200.0', 'AED'), RangeError); // AED needs 2 decimals
  assert.throws(() => toMinor('1200', 'AED'), RangeError); // no decimal point at all
  assert.throws(() => toMinor('12e2', 'AED'), RangeError); // float notation is not money
});

test('format prints minor units with the currency decimals and a leading zero', () => {
  assert.equal(format(120000n, 'AED'), '1200.00');
  assert.equal(format(5n, 'AED'), '0.05');
  assert.equal(format(0n, 'AED'), '0.00');
  assert.equal(format(-37000n, 'AED'), '-370.00');
  assert.equal(format(10004n, 'BHD'), '10.004');
  assert.equal(format(4n, 'BHD'), '0.004');
  assert.equal(format(0n, 'BHD'), '0.000');
});

test('format and toMinor round-trip', () => {
  for (const text of ['0.00', '0.01', '250.00', '-335.00', '99999999.99']) {
    assert.equal(format(toMinor(text, 'AED'), 'AED'), text);
  }
});

test('roundHalfUp rounds exactly one half up and anything below down', () => {
  assert.equal(roundHalfUp(114n, 10n), 11n); // 11.4 -> 11
  assert.equal(roundHalfUp(115n, 10n), 12n); // 11.5 -> 12 (half goes UP)
  assert.equal(roundHalfUp(116n, 10n), 12n); // 11.6 -> 12
  assert.equal(roundHalfUp(110n, 10n), 11n); // exact, nothing to round
  assert.equal(roundHalfUp(0n, 10n), 0n);
});

test('roundHalfUp reproduces the interest figures of the scenario (balance * 4 / 10000)', () => {
  assert.equal(roundHalfUp(25000n * 4n, 10000n), 10n); // AED 250.00 -> 0.10
  assert.equal(roundHalfUp(65000n * 4n, 10000n), 26n); // AED 650.00 -> 0.26
  assert.equal(roundHalfUp(28500n * 4n, 10000n), 11n); // AED 285.00 -> 11.4 -> 0.11
  assert.equal(roundHalfUp(26000n * 4n, 10000n), 10n); // AED 260.00 -> 10.4 -> 0.10
  assert.equal(roundHalfUp(10000n * 4n, 10000n), 4n); // BHD 10.000 -> 0.004
});

test('roundHalfUp refuses inputs it is not defined for', () => {
  assert.throws(() => roundHalfUp(-1n, 10n), RangeError);
  assert.throws(() => roundHalfUp(1n, 0n), RangeError);
});

test('splitInstalments gives the remainder to the first instalment and sums exactly', () => {
  assert.deepEqual(splitInstalments(10000n, 3), [3334n, 3333n, 3333n]); // BHD 10.000
  assert.deepEqual(splitInstalments(10000n, 4), [2500n, 2500n, 2500n, 2500n]);
  assert.deepEqual(splitInstalments(100n, 3), [34n, 33n, 33n]);
  assert.deepEqual(splitInstalments(2n, 3), [2n, 0n, 0n]);
  assert.deepEqual(splitInstalments(10000n, 1), [10000n]);
  for (const count of [1, 2, 3, 7]) {
    const sum = splitInstalments(10000n, count).reduce((a, b) => a + b, 0n);
    assert.equal(sum, 10000n);
  }
});

test('splitInstalments rejects a non-positive or fractional count', () => {
  assert.throws(() => splitInstalments(10000n, 0), RangeError);
  assert.throws(() => splitInstalments(10000n, 1.5), RangeError);
});
