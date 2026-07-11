"use client";

import { useState } from "react";
import { formatMoney, memberName, todayISO } from "@/lib/format";
import { getStore } from "@/lib/store";
import { computeExpenseBreakdown, type Balance, type Transfer } from "@/lib/split";
import { groupRateFor, type GroupBundle } from "@/lib/types";
import { FxRatesEditor } from "./FxRatesEditor";
import { Avatar, Sheet } from "./ui";

interface StatementLine {
  label: string;
  detail: string;
  amount: number; // in home currency; + = owed to them, − = they owe
}

/** Explain a member's balance: their share of each expense + settlements. */
function buildStatement(
  memberId: string,
  bundle: GroupBundle,
  home: string,
): StatementLine[] {
  const { group, members, expenses, settlements } = bundle;
  const nameFor = (id: string) =>
    members.find((m) => m.id === id)?.name ?? "—";
  const lines: StatementLine[] = [];

  for (const e of expenses) {
    if (e.archivedAt || e.deletedAt) continue;
    const rate = groupRateFor(group, e.currency, e.fxRateToHome);
    const bd = computeExpenseBreakdown(e, home, rate);
    if (e.payerMemberId === memberId) {
      const owedToYou = bd.shares.reduce(
        (s, sh) => (sh.memberId === memberId ? s : s + sh.owedHome),
        0,
      );
      if (Math.abs(owedToYou) >= 0.005)
        lines.push({
          label: e.label || "Expense",
          detail: "you paid · others owe you",
          amount: owedToYou,
        });
    } else {
      const share = bd.shares.find((sh) => sh.memberId === memberId);
      if (share && Math.abs(share.owedHome) >= 0.005)
        lines.push({
          label: e.label || "Expense",
          detail: `${nameFor(e.payerMemberId)} paid · your share`,
          amount: -share.owedHome,
        });
    }
  }

  for (const s of settlements) {
    if (s.archivedAt) continue;
    if (s.fromMemberId === memberId)
      lines.push({
        label: `You paid ${nameFor(s.toMemberId)}`,
        detail: "settlement",
        amount: s.amount,
      });
    else if (s.toMemberId === memberId)
      lines.push({
        label: `${nameFor(s.fromMemberId)} paid you`,
        detail: "settlement",
        amount: -s.amount,
      });
  }
  return lines;
}

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const home = bundle.group.homeCurrency;
  const { members } = bundle;

  const signed = (n: number) =>
    `${n >= 0 ? "+" : "−"}${formatMoney(Math.abs(n), home)}`;

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
            const open = expanded === m.id;
            const lines = open ? buildStatement(m.id, bundle, home) : [];
            return (
              <div key={m.id}>
                <button
                  onClick={() => setExpanded(open ? null : m.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
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
                  <span className="text-xs text-muted">{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div className="space-y-1.5 bg-black/[0.02] px-4 pb-3 pt-1">
                    {lines.length === 0 ? (
                      <p className="text-xs text-muted">
                        Nothing to break down yet.
                      </p>
                    ) : (
                      lines.map((l, i) => (
                        <div
                          key={i}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="truncate">{l.label}</div>
                            <div className="text-xs text-muted">{l.detail}</div>
                          </div>
                          <span
                            className={
                              l.amount >= 0 ? "text-positive" : "text-negative"
                            }
                          >
                            {signed(l.amount)}
                          </span>
                        </div>
                      ))
                    )}
                    <div className="flex justify-between border-t border-border pt-1.5 text-sm font-semibold">
                      <span>Net</span>
                      <span
                        className={
                          settled
                            ? "text-muted"
                            : bal > 0
                              ? "text-positive"
                              : "text-negative"
                        }
                      >
                        {settled ? formatMoney(0, home) : signed(bal)}
                      </span>
                    </div>
                  </div>
                )}
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
