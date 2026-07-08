"use client";

import { useState } from "react";
import { CURRENCIES } from "@/lib/currencies";
import { getStore } from "@/lib/store";
import { groupCurrencies, type GroupBundle } from "@/lib/types";
import { CurrencyList } from "./CurrencyList";
import { FxRatesEditor } from "./FxRatesEditor";
import { Sheet } from "./ui";

export function GroupSettingsSheet({
  bundle,
  onClose,
  onChanged,
  onDeleted,
}: {
  bundle: GroupBundle;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const { group } = bundle;
  const [name, setName] = useState(group.name);
  const [home, setHome] = useState(group.homeCurrency);
  const [currencies, setCurrencies] = useState<string[]>(() =>
    groupCurrencies(group),
  );
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText.trim().toLowerCase() === "delete";

  async function deleteGroup() {
    if (!canDelete) return;
    setBusy(true);
    const store = await getStore();
    await store.deleteGroup(group.id);
    onDeleted();
  }

  function changeHome(next: string) {
    setHome(next);
    setCurrencies((prev) => [next, ...prev].filter((c, i, a) => a.indexOf(c) === i));
  }

  async function save() {
    setBusy(true);
    const store = await getStore();
    await store.updateGroup(group.id, {
      name: name.trim() || group.name,
      homeCurrency: home,
      currencies,
    });
    setBusy(false);
    await onChanged();
    onClose();
  }

  return (
    <Sheet
      open
      title="Group settings"
      onClose={onClose}
      footer={
        <button className="btn-brand w-full" onClick={save} disabled={busy}>
          Save
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Group name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Home currency (for settle-up)</label>
          <select
            className="input"
            value={home}
            onChange={(e) => changeHome(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Trip currencies</label>
          <CurrencyList home={home} value={currencies} onChange={setCurrencies} />
        </div>
        <div>
          <label className="label">Exchange rates</label>
          <FxRatesEditor bundle={bundle} onChanged={onChanged} />
        </div>
        <p className="text-xs text-muted">
          Changing the home currency re-expresses everyone&apos;s balances in the
          new currency using each expense&apos;s saved rate.
        </p>

        <div className="mt-2 rounded-2xl border border-negative/30 bg-negative/5 p-4">
          <h3 className="text-sm font-semibold text-negative">Danger zone</h3>
          <p className="mt-1 text-xs text-muted">
            Permanently deletes this group and everything in it — expenses,
            balances, history — for everyone. This cannot be undone. Type{" "}
            <span className="font-semibold">delete</span> to confirm.
          </p>
          <input
            className="input mt-3"
            placeholder="delete"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-negative px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            disabled={!canDelete || busy}
            onClick={deleteGroup}
          >
            Delete this group
          </button>
        </div>
      </div>
    </Sheet>
  );
}
