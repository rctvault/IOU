// Foreign-exchange rates. Rates come from open.er-api.com (free, no API key).
// Fetches are cached by Next's data cache (revalidated every 6h) so we are not
// hammering the API — rates for a currency pair barely move intraday, and the
// user can always override the rate on an individual expense.

export interface FxResult {
  /** Multiply an amount in `from` by this to get the amount in `to`. */
  rate: number;
  /** Source of the rate, useful for showing "auto" vs "same currency". */
  source: "same" | "api";
  /** When the underlying rate table was last updated (ISO-ish string). */
  asOf: string;
}

const ENDPOINT = "https://open.er-api.com/v6/latest";
const SIX_HOURS = 6 * 60 * 60;

/**
 * Server-side rate lookup. Do NOT import into client components — it relies on
 * Next's server `fetch` caching. Client code should call `fetchFxRate` instead,
 * which goes through the /api/fx route.
 */
export async function getFxRate(from: string, to: string): Promise<FxResult> {
  const base = from.toUpperCase();
  const quote = to.toUpperCase();
  if (base === quote) {
    return { rate: 1, source: "same", asOf: new Date().toISOString() };
  }

  const res = await fetch(`${ENDPOINT}/${base}`, {
    next: { revalidate: SIX_HOURS },
  });
  if (!res.ok) {
    throw new Error(`FX provider returned ${res.status}`);
  }
  const data = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };
  const rate = data.rates?.[quote];
  if (data.result !== "success" || typeof rate !== "number") {
    throw new Error(`No FX rate for ${base}->${quote}`);
  }
  return {
    rate,
    source: "api",
    asOf: data.time_last_update_utc ?? new Date().toISOString(),
  };
}

/**
 * Client-side helper: fetch a rate via our own API route. Returns null on any
 * failure so the caller can gracefully fall back to a manual rate of 1.
 */
export async function fetchFxRate(
  from: string,
  to: string,
): Promise<FxResult | null> {
  try {
    const res = await fetch(
      `/api/fx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as FxResult;
  } catch {
    return null;
  }
}
