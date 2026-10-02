# NUMBERS.md: every constant, why that value, and what half of it would do

All constants live in two places: `src/money.ts` (currency decimals) and `src/replay.ts` (window, fee, rate).
Each one below states where it comes from and what the run would look like with a different value, so that
"why that number" has an answer backed by arithmetic rather than habit.

## 1. Overdraft fee: 2500 fils = AED 25.00 (`OVERDRAFT_FEE` in `src/replay.ts`)

- **Why this value:** fixed by the brief (P3). It is a flat penalty for closing a day negative, not a
  percentage, so it is one integer in minor units: `2500n`.
- **Why not half (1250 fils = 12.50):** D5 would close at -347.50 instead of -360.00; D6 would close at
  272.50 and accrue 0.11 (27250 x 4 / 10000 = 10.9, half-up -> 11), so capitalised interest would be 0.68 and
  the final balance 273.18 instead of 260.67. Every expected result after D5 would move. The value is the
  bank's tariff, not a tuning knob.
- **Why AED only:** the tariff is defined in AED and no FX rate is given, so it is never assessed on BHD
  (see AMBIGUITIES.md item 4).

## 2. Interest rate: 4 / 10000 per day = 0.04 % (`RATE_NUMERATOR = 4n`, `RATE_DENOMINATOR = 10000n`)

- **Why this value:** fixed by the brief (P4): `accrual = round_half_up(closing_minor * 4 / 10000)`.
- **Why two integers and not `0.0004`:** `0.0004` is a float; `28500 * 0.0004` is `11.400000000000002` in
  IEEE-754. Multiplying by `4n` and dividing by `10000n` in bigint arithmetic is exact and the rounding step is
  the only place a fraction is ever discarded, deliberately.
- **Why not half (2 / 10000):** accruals would be 0.05, 0.05, 0.13, 0.06, 0.00, 0.05 (D4: 5.7 -> 6, D6:
  5.2 -> 5) = 0.34 capitalised instead of 0.67, and ACC-002 would capitalise 0.002 instead of 0.004.

## 3. AED minor unit: 2 decimals, 1 AED = 100 fils (`DECIMALS.AED` in `src/money.ts`)

- **Why this value:** ISO 4217 gives AED a minor-unit exponent of 2. Every AED amount in the brief has two
  decimals.
- **Why not 1 decimal:** amounts would be rounded before they are even stored. D4's accrual would become
  2850 x 4 / 10000 = 1.14 -> 1 (0.1 instead of 0.11), the capitalised total 0.7 instead of 0.67, and the
  25.00 fee would still fit while the 0.67 credit would not exist as such. Precision is a property of the
  currency, not a choice.

## 4. BHD minor unit: 3 decimals, 1 BHD = 1000 fils (`DECIMALS.BHD`)

- **Why this value:** ISO 4217 gives BHD an exponent of 3; the brief writes BHD 10.000.
- **Why not 2 decimals (the AED convention):** the three instalments would be 3.34 + 3.33 + 3.33, and the
  D6 accrual 1000 x 4 / 10000 = 0.4 -> 0, so ACC-002 would capitalise 0.00 instead of 0.004: interest
  silently lost to representation. `toMinor` therefore refuses "10.00" for BHD instead of guessing.

## 5. Rounding mode: half up (`roundHalfUp` in `src/money.ts`)

- **Why this mode:** fixed by the brief (P4). Half-up is the rounding people do by hand, so a customer can
  verify the statement: 11.4 -> 11, 11.5 -> 12, 10.4 -> 10.
- **How it is exact:** `quotient = n / d`, `remainder = n % d`, round up iff `remainder * 2 >= d`. No
  floats, no `Math.round`.
- **What other modes would do here:** this scenario has no exact-half case (fractions are .0, .4 and .4),
  so half-down, half-even (banker's) and plain truncation would all give the same 0.67 today. The mode still
  has to be pinned: on another data set they diverge, and truncation would always be against the customer.
- **Why only for non-negative input:** interest is accrued only when the closing balance is > 0, so the
  question "does half round up towards +infinity or away from zero for negatives" never arises; the function
  throws rather than guess.

## 6. Instalment remainder goes to the FIRST instalment (`splitInstalments`)

- **Why this rule:** fixed by the brief (P9). `10000n / 3n = 3333n` remainder `1n`, so 3.334 + 3.333 +
  3.333 = 10.000 exactly. The sum constraint holds by construction: `share * count + remainder = total`.
- **Why not the last instalment:** 3.333 + 3.333 + 3.334 sums to the same 10.000 and changes which entry is
  larger; nothing else. Either is correct, one had to be chosen, and the brief chose first (the instalment that
  certainly exists even if the schedule is later shortened).
- **Why not spread it:** with a remainder of up to `count - 1` fils there is nothing to spread; the
  remainder is always smaller than the count.

## 7. Window: Day 1 to Day 6 (`FIRST_DAY = 1`, `LAST_DAY = 6` in `src/replay.ts`)

- **Why these values:** the brief defines the window. `finish()` closes every day up to `LAST_DAY` even if
  the stream ends early, and Day 6's EOD runs after the last event (P2).
- **Why not half (Day 1 to Day 3):** EOD would stop after D3 (closing 650.00, accruals 0.46), and E5 .. E10
  (both settlements, the back-valued debit, the declined auth, the reversal, the instalments) would never be
  processed. The window is the reporting period, not a performance setting.

## 8. Capitalisation: once, on D6, one credit per account (`capitalise` in `src/replay.ts`)

- **Why:** fixed by the brief (P4): after Day 6's accrual, one credit per account, value date D6, equal to
  the EXACT SUM of the rounded daily accruals. Summing the already-rounded memos is what makes the sum
  constraint hold by construction (0.10 + 0.10 + 0.26 + 0.11 + 0.00 + 0.10 = 0.67, no second rounding).
- **Why not daily capitalisation (six entries):** it would compound inside the window and put six tiny
  entries in the journal. On this data the end result happens to coincide (260.67) because every daily
  accrual still rounds to the same fils, but the design would be different: the memo-then-capitalise split is
  what keeps accruals out of the ledger until the period ends.
- **Why a zero sum posts nothing:** an entry of 0.00 carries no information; both accounts accrued more
  than zero here, so this branch never runs in the scenario.

## 9. Smaller numbers worth naming

- **Opening balances 0.00 / 0.000:** no opening entries are posted; a non-zero opening would simply be the
  first entry.
- **Instalment count 3:** carried by the event (`instalments: 3`), not a global constant.
- **Entry ids** such as `FEE-ACC-001-D5` and `INT-ACC-001-D6` encode account and day so that "at most one
  fee per account per day" is also enforced by the ledger's duplicate-id check, on top of the EOD idempotency
  set.
