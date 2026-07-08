"use client";

import { useEffect, useState } from "react";
import { fetchFxRate } from "@/lib/fx";
import { getStore } from "@/lib/store";
import { groupCurrencies, type FxRateEntry, type GroupBundle } from "@/lib/types";

/**
 * Editor for the group's per-currency exchange rates. One rate per non-home
 * currency, shared by every expense in that currency. Editing a rate marks it
 * "manual"; "Use live rate" re-fetches and marks it "auto". Saving triggers a
 * reload so balances recompute.
 */
export function FxRatesEditor({
  bundle,
  onChanged,
}: {
  bundle: GroupBundle;
  onChanged: () => Promise<void> | void;
}) {
  const { group } = bundle;
  const home = group.homeCurrency;
  const currencies = groupCurrencies(group).filter((c) => c !== home);

  const [rates, setRates] = useState<Record<string, FxRateEntry>>(
    () => ({ ...(group.fxRates ?? {}) }),
  );
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(group.fxRates ?? {}).map(([c, e]) => [c, String(e.rate)]),
    ),
  );

  // Fetch an auto default for any currency without a rate yet.
  useEffect(() => {
    let active = true;
    (async () => {
      for (const c of currencies) {
        if (rates[c]) continue;
        const fx = await fetchFxRate(c, home);
        if (!active) return;
        const rate = fx?.rate ?? 1;
        setRates((prev) =>
          prev[c] ? prev : { ...prev, [c]: { rate, manual: false } },
        );
        setText((prev) => (prev[c] ? prev : { ...prev, [c]: String(rate) }));
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [error, setError] = useState<string | null>(null);

  async function save(next: Record<string, FxRateEntry>) {
    setRates(next);
    try {
      const store = await getStore();
      await store.updateGroup(group.id, { fxRates: next });
      setError(null);
      await onChanged();
    } catch {
      setError(
        "Couldn't save the rate. If this just launched, re-run supabase/schema.sql.",
      );
    }
  }

  function commit(c: string) {
    const v = parseFloat(text[c]);
    if (!Number.isFinite(v) || v <= 0) {
      setText((t) => ({ ...t, [c]: String(rates[c]?.rate ?? "") }));
      return;
    }
    if (v === rates[c]?.rate && rates[c]?.manual) return;
    save({ ...rates, [c]: { rate: v, manual: true } });
  }

  async function useLive(c: string) {
    const fx = await fetchFxRate(c, home);
    const rate = fx?.rate ?? rates[c]?.rate ?? 1;
    setText((t) => ({ ...t, [c]: String(rate) }));
    save({ ...rates, [c]: { rate, manual: false } });
  }

  if (currencies.length === 0) {
    return (
      <p className="text-sm text-muted">
        No foreign currencies in this trip yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {currencies.map((c) => {
        const manual = rates[c]?.manual;
        return (
          <div key={c} className="rounded-xl border border-border bg-surface p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium">
                {c} → {home}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  manual
                    ? "bg-brand/10 font-medium text-brand"
                    : "bg-black/5 text-muted"
                }`}
              >
                {manual ? "manual" : "auto"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-muted">1 {c} =</span>
              <input
                className="input flex-1"
                inputMode="decimal"
                value={text[c] ?? ""}
                placeholder="…"
                onChange={(e) =>
                  setText((t) => ({ ...t, [c]: e.target.value }))
                }
                onBlur={() => commit(c)}
              />
              <span className="shrink-0 text-sm text-muted">{home}</span>
            </div>
            <button
              onClick={() => useLive(c)}
              className="mt-1.5 text-xs font-medium text-brand"
            >
              ↻ Use live rate
            </button>
          </div>
        );
      })}
      {error && <p className="text-xs text-negative">{error}</p>}
      <p className="pt-1 text-xs text-muted">
        Each rate applies to every expense in that currency. Type your own to
        match the rate your bank gave you.
      </p>
    </div>
  );
}
