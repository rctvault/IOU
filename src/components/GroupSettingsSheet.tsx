"use client";

import { useState } from "react";
import { CURRENCIES } from "@/lib/currencies";
import { getStore } from "@/lib/store";
import {
  groupCurrencies,
  groupDefaultCurrency,
  type GroupBundle,
} from "@/lib/types";
import { CurrencyList } from "./CurrencyList";
import { FxRatesEditor } from "./FxRatesEditor";
import { MembersSection } from "./MembersSection";
import { Sheet, UnsavedDialog } from "./ui";

/** Supabase throws plain error objects, not Error instances. */
function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message)
      : "";
}

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
  const [defaultCur, setDefaultCur] = useState(() =>
    groupDefaultCurrency(group),
  );
  // The picked default only counts while it is still a trip currency.
  const effectiveDefault = currencies.includes(defaultCur) ? defaultCur : home;
  // Name and currency edits only apply on Save (members save instantly), so
  // closing with them changed warns first.
  const snapshot = JSON.stringify([name.trim(), home, currencies, effectiveDefault]);
  const [initialSnapshot] = useState(snapshot);
  const dirty = snapshot !== initialSnapshot;
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [delError, setDelError] = useState<string | null>(null);
  const canDelete = confirmText.trim().toLowerCase() === "delete";

  async function deleteGroup() {
    if (!canDelete) return;
    setBusy(true);
    setDelError(null);
    try {
      const store = await getStore();
      // Re-establish this group's code as the active one right before deleting,
      // so a stale active code from an earlier group can't misfire the delete.
      const bundle = await store.getGroupByCode(group.shareCode);
      if (!bundle) {
        // Already gone from the backend.
        onDeleted();
        return;
      }
      await store.deleteGroup(bundle.group.id);
      onDeleted();
    } catch (err) {
      console.error("delete group failed:", err);
      const msg = errorMessage(err);
      setDelError(msg ? `Couldn't delete: ${msg}` : "Couldn't delete. Try again.");
      setBusy(false);
    }
  }

  function changeHome(next: string) {
    // A default that was just following the home currency keeps following it.
    if (defaultCur === home) setDefaultCur(next);
    setHome(next);
    setCurrencies((prev) => [next, ...prev].filter((c, i, a) => a.indexOf(c) === i));
  }

  function beforeClose() {
    if (!dirty || busy) return true;
    setConfirmingClose(true);
    return false;
  }

  async function save() {
    setConfirmingClose(false);
    setBusy(true);
    setSaveError(null);
    try {
      const store = await getStore();
      await store.updateGroup(group.id, {
        name: name.trim() || group.name,
        homeCurrency: home,
        currencies,
      });
    } catch (err) {
      console.error("save group failed:", err);
      const msg = errorMessage(err);
      setSaveError(msg ? `Couldn't save: ${msg}` : "Couldn't save. Try again.");
      setBusy(false);
      return;
    }
    // Saved separately, and only when changed, so everything above still saves
    // on a DB that hasn't had supabase/add-default-currency.sql run yet.
    if (effectiveDefault !== groupDefaultCurrency(group)) {
      try {
        const store = await getStore();
        await store.updateGroup(group.id, { defaultCurrency: effectiveDefault });
      } catch (err) {
        console.error("save default currency failed:", err);
        await onChanged();
        setSaveError(
          "Saved, except the default currency — the database needs supabase/add-default-currency.sql run first.",
        );
        setBusy(false);
        return;
      }
    }
    await onChanged();
    onClose();
  }

  return (
    <Sheet
      open
      title="Settings"
      onClose={onClose}
      beforeClose={beforeClose}
      footer={
        <>
          {saveError && (
            <p className="mb-2 text-xs text-negative">{saveError}</p>
          )}
          <button className="btn-brand w-full" onClick={save} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted">Members</h3>
        <MembersSection bundle={bundle} onChanged={onChanged} />

        <h3 className="border-t border-border pt-4 text-sm font-semibold text-muted">
          Currencies
        </h3>
        <div>
          <label className="label">Trip currencies</label>
          <CurrencyList home={home} value={currencies} onChange={setCurrencies} />
        </div>
        <div>
          <label className="label">Default currency for new expenses</label>
          <select
            className="input"
            value={effectiveDefault}
            onChange={(e) => setDefaultCur(e.target.value)}
          >
            {[home, ...currencies]
              .filter((c, i, a) => a.indexOf(c) === i)
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Each new expense starts in this currency — you can still pick another
            one per expense.
          </p>
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
          <p className="mt-1 text-xs text-muted">
            Changing the home currency re-expresses everyone&apos;s balances in
            the new currency using each expense&apos;s saved rate.
          </p>
        </div>
        <div>
          <label className="label">Exchange rates</label>
          <FxRatesEditor bundle={bundle} onChanged={onChanged} />
        </div>

        <h3 className="border-t border-border pt-4 text-sm font-semibold text-muted">
          Group
        </h3>
        <div>
          <label className="label">Group name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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
          {delError && (
            <p className="mt-2 text-xs text-negative">{delError}</p>
          )}
        </div>
      </div>
      {confirmingClose && (
        <UnsavedDialog
          title="Your settings haven't been saved"
          message="Changes to the group name or currencies only apply when you save. If you close now, they will be lost."
          saveLabel="Save settings"
          canSave
          busy={busy}
          onSave={save}
          onKeepEditing={() => setConfirmingClose(false)}
          onDiscard={onClose}
        />
      )}
    </Sheet>
  );
}
