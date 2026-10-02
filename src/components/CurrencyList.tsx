"use client";

import { CURRENCIES } from "@/lib/currencies";

/**
 * Editor for a group's list of trip currencies. `home` is always present and
 * cannot be removed. `value` includes `home`. Calls `onChange` with the full
 * de-duplicated list (home first).
 */
export function CurrencyList({
  home,
  value,
  onChange,
}: {
  home: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const list = [home, ...value].filter((c, i, a) => c && a.indexOf(c) === i);
  const available = CURRENCIES.filter((c) => !list.includes(c.code));

  function add(code: string) {
    if (!code) return;
    onChange([...list, code]);
  }
  function remove(code: string) {
    if (code === home) return;
    onChange(list.filter((c) => c !== code));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {list.map((code) => (
          <span
            key={code}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
              code === home
                ? "border-brand bg-brand/10 font-semibold text-brand"
                : "border-border"
            }`}
          >
            {code}
            {code === home ? (
              <span className="text-xs uppercase tracking-wide text-brand/70">
                home
              </span>
            ) : (
              <button
                type="button"
                onClick={() => remove(code)}
                className="text-muted hover:text-negative"
                aria-label={`Remove ${code}`}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {available.length > 0 && (
        // Picking a currency adds it straight away (no separate Add step).
        <select
          className="input"
          value=""
          onChange={(e) => add(e.target.value)}
        >
          <option value="">+ Add a currency…</option>
          {available.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
