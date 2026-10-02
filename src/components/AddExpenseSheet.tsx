"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { roundMoney } from "@/lib/currency";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { fetchFxRate } from "@/lib/fx";
import { getStore } from "@/lib/store";
import { computeExpenseBreakdown, type Expense, type LineItem } from "@/lib/split";
import {
  groupCurrencies,
  groupDefaultCurrency,
  isActive,
  type ExpenseRecord,
  type GroupBundle,
} from "@/lib/types";
import { Avatar, Sheet, UnsavedDialog } from "./ui";

interface MemberState {
  memberId: string;
  included: boolean;
  discountPct: number;
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function AddExpenseSheet({
  bundle,
  editing,
  me,
  onClose,
  onSaved,
}: {
  bundle: GroupBundle;
  editing: ExpenseRecord | null;
  me?: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { group } = bundle;
  const home = group.homeCurrency;

  // Show active members, plus anyone already on this expense (so editing an old
  // bill still shows a member who has since left).
  const involvedIds = new Set(
    editing ? [editing.payerMemberId, ...editing.participants.map((p) => p.memberId)] : [],
  );
  const members = bundle.members.filter(
    (m) => isActive(m) || involvedIds.has(m.id),
  );

  const [label, setLabel] = useState(editing?.label ?? "");
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [payerId, setPayerId] = useState(
    editing?.payerMemberId ??
      (me && members.some((m) => m.id === me) ? me : members[0]?.id) ??
      "",
  );
  const [currency, setCurrency] = useState(
    editing?.currency ?? groupDefaultCurrency(group),
  );
  // Currencies offered in the picker: the group's trip currencies (managed in
  // Settings), plus this expense's currency if it was since removed from the
  // group.
  const available = [...groupCurrencies(group), editing?.currency ?? ""].filter(
    (c, i, a) => c && a.indexOf(c) === i,
  );
  // Auto-fetched rate for a currency the group doesn't have a rate for yet.
  const [autoRate, setAutoRate] = useState<number | null>(null);
  // Amounts are assumed to already include tax. Unticking "Tax included" treats
  // them as pre-tax and adds a percentage on top. A stored tax rate of 0 is the
  // tax-included case, so no extra field is persisted.
  const [taxIncluded, setTaxIncluded] = useState(!editing?.taxRate);
  const [taxRate, setTaxRate] = useState(
    editing?.taxRate ? String(editing.taxRate) : "",
  );
  const effectiveTaxRate = taxIncluded ? 0 : num(taxRate);
  const [splitMode, setSplitMode] = useState<"equal" | "itemized">(
    editing?.splitMode ?? "equal",
  );
  const [subtotal, setSubtotal] = useState(
    editing?.subtotal != null ? String(editing.subtotal) : "",
  );
  const [items, setItems] = useState<LineItem[]>(
    editing?.lineItems?.length ? editing.lineItems : [{ amount: 0, memberId: null }],
  );
  const [showDiscounts, setShowDiscounts] = useState(
    (editing?.participants ?? []).some((p) => p.discountPct > 0),
  );
  const [busy, setBusy] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  // Open the native date picker from the compact date chip.
  function openDatePicker() {
    const el = dateRef.current as
      | (HTMLInputElement & { showPicker?: () => void })
      | null;
    if (!el) return;
    try {
      if (typeof el.showPicker === "function") {
        el.showPicker();
        return;
      }
    } catch {
      // fall through
    }
    el.focus();
    el.click();
  }

  const [memberStates, setMemberStates] = useState<MemberState[]>(() =>
    members.map((m) => {
      const p = editing?.participants.find((x) => x.memberId === m.id);
      return {
        memberId: m.id,
        included: editing ? Boolean(p) : true,
        discountPct: p?.discountPct ?? 0,
      };
    }),
  );

  // The trip rate for this currency (if the group has one), else null.
  const groupRate =
    currency === home ? 1 : group.fxRates?.[currency]?.rate ?? null;
  const effectiveRate =
    currency === home
      ? 1
      : groupRate ?? autoRate ?? editing?.fxRateToHome ?? 1;

  // Fetch a rate only when the group doesn't already have one for this currency.
  useEffect(() => {
    let active = true;
    if (currency === home || group.fxRates?.[currency]) {
      setAutoRate(null);
      return;
    }
    (async () => {
      const result = await fetchFxRate(currency, home);
      if (active) setAutoRate(result?.rate ?? null);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, home]);

  const included = memberStates.filter((s) => s.included);

  // Everything the user can change, compared against how the sheet opened, so
  // closing with unsaved input can warn first.
  const snapshot = JSON.stringify([
    label,
    date,
    payerId,
    currency,
    taxIncluded,
    taxRate,
    splitMode,
    subtotal,
    items,
    memberStates,
  ]);
  const [initialSnapshot] = useState(snapshot);
  const dirty = snapshot !== initialSnapshot;
  const [confirmingClose, setConfirmingClose] = useState(false);

  function beforeClose() {
    if (!dirty || busy) return true;
    setConfirmingClose(true);
    return false;
  }

  const draft: Expense = useMemo(
    () => ({
      id: "preview",
      payerMemberId: payerId,
      currency,
      fxRateToHome: effectiveRate,
      taxRate: effectiveTaxRate,
      splitMode,
      subtotal: splitMode === "equal" ? num(subtotal) : undefined,
      lineItems: splitMode === "itemized" ? items : [],
      participants: included.map((s) => ({
        memberId: s.memberId,
        discountPct: s.discountPct,
      })),
    }),
    [payerId, currency, effectiveRate, effectiveTaxRate, splitMode, subtotal, items, included],
  );

  const breakdown = useMemo(
    () => (included.length ? computeExpenseBreakdown(draft, home) : null),
    [draft, included.length, home],
  );

  function toggleMember(id: string) {
    setMemberStates((prev) =>
      prev.map((s) => (s.memberId === id ? { ...s, included: !s.included } : s)),
    );
  }
  function setAllIncluded(included: boolean) {
    setMemberStates((prev) => prev.map((s) => ({ ...s, included })));
  }
  function setDiscount(id: string, v: number) {
    setMemberStates((prev) =>
      prev.map((s) =>
        s.memberId === id
          ? { ...s, discountPct: Math.max(0, Math.min(100, v)) }
          : s,
      ),
    );
  }

  // What still has to be filled in before the expense can be saved.
  const missing = [
    !label.trim() && "a title",
    !(splitMode === "equal"
      ? num(subtotal) > 0
      : items.some((i) => i.amount > 0)) && "an amount",
    included.length === 0 && "someone to split it between",
  ].filter(Boolean) as string[];
  const canSave = Boolean(payerId) && missing.length === 0;
  const missingText = missing.join(missing.length > 2 ? ", " : " and ");

  async function save() {
    if (!canSave) return;
    setBusy(true);
    const store = await getStore();
    // Make sure the group has a trip rate for this currency (auto), so it's
    // shown and editable in Settle up and shared by every expense. Non-fatal:
    // if it fails (e.g. DB not migrated yet), the expense still saves and
    // converts via its own stored rate.
    if (currency !== home && !group.fxRates?.[currency]) {
      try {
        await store.updateGroup(group.id, {
          fxRates: {
            ...(group.fxRates ?? {}),
            [currency]: { rate: effectiveRate, manual: false },
          },
        });
      } catch {
        // ignore — rate falls back to the expense's own fxRateToHome
      }
    }
    const record = {
      label: label.trim(),
      payerMemberId: payerId,
      currency,
      fxRateToHome: effectiveRate,
      taxRate: effectiveTaxRate,
      splitMode,
      subtotal: splitMode === "equal" ? num(subtotal) : undefined,
      lineItems: splitMode === "itemized" ? items.filter((i) => i.amount > 0) : [],
      participants: included.map((s) => ({
        memberId: s.memberId,
        discountPct: s.discountPct,
      })),
      date: date || todayISO(),
    };
    if (editing) await store.updateExpense(editing.id, record);
    else await store.addExpense(group.id, record);
    setBusy(false);
    await onSaved();
  }

  async function remove() {
    if (!editing) return;
    if (
      !window.confirm(
        `Move "${editing.label || "this expense"}" to Trash? You can restore it later.`,
      )
    )
      return;
    setBusy(true);
    const store = await getStore();
    await store.deleteExpense(editing.id);
    setBusy(false);
    await onSaved();
  }

  const itemsTotal = roundMoney(
    items.reduce((a, i) => a + i.amount, 0),
    currency,
  );

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "—";

  return (
    <Sheet
      open
      title={editing ? "Edit expense" : "Add expense"}
      onClose={onClose}
      beforeClose={beforeClose}
      footer={
        <>
          {dirty && missing.length > 0 && (
            <p className="mb-2 text-xs text-muted">
              Needs {missingText} before it can be saved.
            </p>
          )}
          <div className="flex gap-3">
            {editing && (
              <button
                className="btn-outline text-negative"
                onClick={remove}
                disabled={busy}
              >
                Delete
              </button>
            )}
            <button
              className="btn-brand flex-1"
              onClick={save}
              disabled={busy || !canSave}
            >
              {editing ? "Save changes" : "Add expense"}
            </button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label mb-0">What was it?</label>
            <button
              type="button"
              onClick={openDatePicker}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted active:scale-[0.98]"
            >
              📅 {date === todayISO() ? "Today" : formatDate(date)}
            </button>
          </div>
          <input
            className="input"
            placeholder="e.g. Dinner at Ichiran"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {/* Hidden native picker driven by the chip above. */}
          <input
            ref={dateRef}
            type="date"
            className="sr-only"
            tabIndex={-1}
            aria-label="Expense date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Payer */}
        <div>
          <label className="label">Paid by</label>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => setPayerId(m.id)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  payerId === m.id
                    ? "border-brand bg-brand/10 font-semibold text-brand"
                    : "border-border"
                }`}
              >
                <Avatar name={m.name} color={m.color} size={22} />
                {m.name}
              </button>
            ))}
          </div>
        </div>

        {/* Currency + amount */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Currency</label>
            <select
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {available.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Amount</label>
            {splitMode === "equal" ? (
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
              />
            ) : (
              // Itemized: the amount is the running total of the items below.
              <input
                className="input text-muted"
                readOnly
                tabIndex={-1}
                aria-label="Items total"
                placeholder="Sum of items"
                value={itemsTotal || ""}
              />
            )}
          </div>
        </div>

        {/* Tax */}
        <div className="flex min-h-10 items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand"
              checked={taxIncluded}
              onChange={(e) => setTaxIncluded(e.target.checked)}
            />
            Tax included
          </label>
          {!taxIncluded && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted">add</span>
              <input
                className="input w-20 text-center"
                inputMode="decimal"
                placeholder="0"
                aria-label="Tax percent"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
              <span className="text-xs text-muted">% tax</span>
            </div>
          )}
        </div>

        {/* Split mode */}
        <div className="flex rounded-xl border border-border p-1 text-sm">
          {(["equal", "itemized"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSplitMode(mode)}
              className={`flex-1 rounded-lg py-2 font-medium capitalize ${
                splitMode === mode ? "bg-brand text-white" : "text-muted"
              }`}
            >
              {mode === "equal" ? "Split equally" : "Itemized"}
            </button>
          ))}
        </div>

        {splitMode === "itemized" && (
          <div className="space-y-2">
            <label className="label">
              Items ({taxIncluded ? "tax included" : "before tax"})
            </label>
            {items.map((it, i) => (
              <div
                key={i}
                className="space-y-2 rounded-xl border border-border p-2"
              >
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="What is it? e.g. Ramen"
                    value={it.description ?? ""}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((p, j) =>
                          j === i ? { ...p, description: e.target.value } : p,
                        ),
                      )
                    }
                  />
                  <button
                    onClick={() =>
                      setItems((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="btn-ghost h-10 w-10 shrink-0 rounded-full !px-0 text-muted"
                    aria-label="Remove item"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="input w-28"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={it.amount || ""}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((p, j) =>
                          j === i ? { ...p, amount: num(e.target.value) } : p,
                        ),
                      )
                    }
                  />
                  <select
                    className="input flex-1"
                    value={it.memberId ?? ""}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((p, j) =>
                          j === i
                            ? { ...p, memberId: e.target.value || null }
                            : p,
                        ),
                      )
                    }
                  >
                    <option value="">Shared</option>
                    {included.map((s) => (
                      <option key={s.memberId} value={s.memberId}>
                        {nameOf(s.memberId)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <button
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  { amount: 0, memberId: null, description: "" },
                ])
              }
              className="btn-outline w-full"
            >
              + Add item
            </button>
          </div>
        )}

        {/* Participants */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <label className="label mb-0">Split between</label>
              {/* Quick select: "None" then tap the few who shared it. */}
              {([true, false] as const).map((on) => (
                <button
                  key={String(on)}
                  onClick={() => setAllIncluded(on)}
                  disabled={memberStates.every((s) => s.included === on)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted active:scale-[0.98] disabled:opacity-40"
                >
                  {on ? "All" : "None"}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowDiscounts((s) => !s)}
              className="text-xs font-medium text-brand"
            >
              {showDiscounts ? "Hide discounts" : "Add discounts"}
            </button>
          </div>
          <div className="space-y-1.5">
            {memberStates.map((s) => {
              const m = members.find((x) => x.id === s.memberId)!;
              return (
                <div key={s.memberId} className="flex items-center gap-2">
                  <button
                    onClick={() => toggleMember(s.memberId)}
                    className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                      s.included ? "border-brand bg-brand/5" : "border-border opacity-50"
                    }`}
                  >
                    <Avatar name={m.name} color={m.color} size={24} />
                    <span className="flex-1 text-left font-medium">
                      {m.name}
                    </span>
                    {s.included && <span className="text-brand">✓</span>}
                  </button>
                  {showDiscounts && s.included && (
                    <div className="flex items-center gap-1">
                      <input
                        className="input w-16 text-center"
                        inputMode="numeric"
                        value={s.discountPct || ""}
                        placeholder="0"
                        onChange={(e) =>
                          setDiscount(s.memberId, num(e.target.value))
                        }
                      />
                      <span className="text-xs text-muted">% off</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Live preview */}
        {breakdown && (
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">Total</span>
              <span className="font-bold">
                {formatMoney(breakdown.grossTotal, currency)}
                {currency !== home && (
                  <span className="ml-1 text-xs text-muted">
                    ≈ {formatMoney(breakdown.grossTotal * effectiveRate, home)}
                  </span>
                )}
              </span>
            </div>
            <div className="space-y-1 text-sm">
              {breakdown.shares.map((sh) => (
                <div
                  key={sh.memberId}
                  className="flex items-center justify-between"
                >
                  <span className="text-muted">
                    {nameOf(sh.memberId)}
                    {sh.memberId === payerId && " (paid)"}
                    {sh.discountPct > 0 && ` · ${sh.discountPct}% off`}
                  </span>
                  <span>
                    {sh.memberId === payerId
                      ? "—"
                      : formatMoney(sh.owed, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {confirmingClose && (
        <UnsavedDialog
          title="This expense hasn't been saved"
          message={
            canSave
              ? "If you close now, what you entered will be lost."
              : `It still needs ${missingText || "a payer"}. If you close now, what you entered will be lost.`
          }
          saveLabel={editing ? "Save changes" : "Save expense"}
          canSave={canSave}
          busy={busy}
          onSave={save}
          onKeepEditing={() => setConfirmingClose(false)}
          onDiscard={onClose}
        />
      )}
    </Sheet>
  );
}
