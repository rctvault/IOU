"use client";

import { useState } from "react";
import { formatMoney, memberName, todayISO } from "@/lib/format";
import { getStore } from "@/lib/store";
import type { Balance, Transfer } from "@/lib/split";
import type { GroupBundle } from "@/lib/types";
import { FxRatesEditor } from "./FxRatesEditor";
import { Avatar, Sheet } from "./ui";

export function SettleUpSheet({
  bundle,
  balances,
  transfers,
  canArchive,
  onClose,
  onSettled,
  onArchive,
}: {
  bundle: GroupBundle;
  balances: Balance[];
  transfers: Transfer[];
  canArchive: boolean;
  onClose: () => void;
  onSettled: () => Promise<void> | void;
  onArchive: () => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const home = bundle.group.homeCurrency;
  const { members } = bundle;

  async function markPaid(t: Transfer) {
    const id = `${t.fromMemberId}-${t.toMemberId}`;
    setBusyId(id);
    const store = await getStore();
    await store.addSettlement(bundle.group.id, {
      fromMemberId: t.fromMemberId,
      toMemberId: t.toMemberId,
      amount: t.amount,
      date: todayISO(),
    });
    setBusyId(null);
    await onSettled();
  }

  return (
    <Sheet open title="Settle up" onClose={onClose}>
      {/* Balances: the overview you check right before squaring up. */}
      <div className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-muted">Balances</h3>
        <div className="card divide-y divide-border">
          {members.map((m) => {
            const bal = balances.find((b) => b.memberId === m.id)?.amount ?? 0;
            const settled = Math.abs(bal) < 0.005;
            return (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.name} color={m.color} size={30} />
                <span className="flex-1 font-medium">{m.name}</span>
                <span
                  className={
                    settled
                      ? "text-sm text-muted"
                      : bal > 0
                        ? "font-semibold text-positive"
                        : "font-semibold text-negative"
                  }
                >
                  {settled
                    ? "settled up"
                    : bal > 0
                      ? `gets back ${formatMoney(bal, home)}`
                      : `owes ${formatMoney(-bal, home)}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <details className="mb-5">
        <summary className="cursor-pointer text-sm font-semibold text-muted">
          Exchange rates
        </summary>
        <div className="mt-2">
          <FxRatesEditor bundle={bundle} onChanged={onSettled} />
        </div>
      </details>

      {transfers.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-muted">🎉 Everyone is settled up.</p>
          {canArchive && (
            <>
              <button
                className="btn-brand mt-4 w-full"
                disabled={archiving}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Archive all current expenses into History and start fresh?",
                    )
                  )
                    return;
                  setArchiving(true);
                  await onArchive();
                }}
              >
                Archive settled expenses & start fresh
              </button>
              <p className="mt-2 text-xs text-muted">
                Moves the current expenses into History and clears the active
                list. Balances stay at zero.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            The simplest way to square up ({home}):
          </p>
          {transfers.map((t) => {
            const id = `${t.fromMemberId}-${t.toMemberId}`;
            const from = members.find((m) => m.id === t.fromMemberId);
            const to = members.find((m) => m.id === t.toMemberId);
            return (
              <div key={id} className="card flex items-center gap-3 p-4">
                {from && <Avatar name={from.name} color={from.color} size={30} />}
                <div className="flex-1 text-sm">
                  <span className="font-semibold">
                    {memberName(members, t.fromMemberId)}
                  </span>{" "}
                  pays{" "}
                  <span className="font-semibold">
                    {memberName(members, t.toMemberId)}
                  </span>
                  <div className="text-base font-bold">
                    {formatMoney(t.amount, home)}
                  </div>
                </div>
                {to && <Avatar name={to.name} color={to.color} size={30} />}
                <button
                  onClick={() => markPaid(t)}
                  className="btn-brand"
                  disabled={busyId === id}
                >
                  Paid
                </button>
              </div>
            );
          })}
        </div>
      )}

      {bundle.settlements.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-muted">
            Recorded payments
          </h3>
          <div className="card divide-y divide-border">
            {[...bundle.settlements]
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="flex-1">
                    {memberName(members, s.fromMemberId)} →{" "}
                    {memberName(members, s.toMemberId)}
                  </span>
                  <span className="font-medium">
                    {formatMoney(s.amount, home)}
                  </span>
                  <button
                    onClick={async () => {
                      if (!window.confirm("Undo this recorded payment?")) return;
                      const store = await getStore();
                      await store.deleteSettlement(s.id);
                      await onSettled();
                    }}
                    className="text-negative"
                    aria-label="Undo payment"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
