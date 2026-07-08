// Currency helpers: how many minor-unit digits a currency has, plus rounding
// and formatting. Kept dependency-free so it can be unit-tested in isolation.

export type CurrencyCode = string; // ISO 4217, e.g. "USD", "JPY", "THB"

// Currencies whose minor unit is not 2 digits. Everything not listed here is
// assumed to have 2 decimal places (the overwhelming default).
const MINOR_DIGITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  HUF: 0,
  TWD: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export function minorDigits(currency: CurrencyCode): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

export function minorFactor(currency: CurrencyCode): number {
  return 10 ** minorDigits(currency);
}

/** Round a value to the currency's smallest unit (half-up on the minor unit). */
export function roundMoney(amount: number, currency: CurrencyCode): number {
  const f = minorFactor(currency);
  // Nudge to avoid binary-float artefacts like 0.5 landing as 0.4999999.
  return Math.round((amount + Number.EPSILON) * f) / f;
}

/** Format for display, e.g. formatMoney(1234.5, "USD") -> "$1,234.50". */
export function formatMoney(amount: number, currency: CurrencyCode): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: minorDigits(currency),
      maximumFractionDigits: minorDigits(currency),
    }).format(amount);
  } catch {
    // Unknown/invalid ISO code — fall back to a plain number + code.
    return `${roundMoney(amount, currency).toFixed(minorDigits(currency))} ${currency}`;
  }
}

/**
 * Split `total` into shares proportional to `weights`, using the
 * largest-remainder method so the rounded shares sum EXACTLY to `total`
 * (down to the currency's smallest unit — no lost cents).
 *
 * If all weights are zero (or none provided), the total is split equally.
 */
export function allocateByWeights(
  total: number,
  weights: number[],
  currency: CurrencyCode,
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const f = minorFactor(currency);
  const totalMinor = Math.round(total * f);

  const sumW = weights.reduce((a, b) => a + b, 0);
  const effectiveWeights = sumW > 0 ? weights : weights.map(() => 1);
  const effSum = sumW > 0 ? sumW : n;

  // Floor each share; track the fractional remainder to distribute leftovers.
  const raw = effectiveWeights.map((w) => (totalMinor * w) / effSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalMinor - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  const shares = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) {
    shares[order[k].i] += 1;
    remainder -= 1;
  }

  return shares.map((s) => s / f);
}
