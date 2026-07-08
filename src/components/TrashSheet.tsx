"use client";

import { useState } from "react";
import { formatDate, formatMoney, memberName } from "@/lib/format";
import { getStore } from "@/lib/store";
import { computeExpenseBreakdown } from "@/lib/split";
import type { GroupBundle } from "@/lib/types";
import { Sheet } from "./ui";

export function TrashSheet({
  bundle,
  onClose,
  onChanged,
}: {
  bundle: GroupBundle;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const trashed = bundle.expenses
    .filter((e) => e.deletedAt)
    .sort((a, b) => ((a.deletedAt ?? "") < (b.deletedAt ?? "") ? 1 : -1));

  async function restore(id: string) {
    setBusyId(id);
    const store = await getStore();
    await store.restoreExpense(id);
    setBusyId(null);
    await onChanged();
  }

  async function purge(id: string, label: string) {
    if (
      !window.confirm(
        `Permanently delete "${label || "this expense"}"? This can't be undone.`,
      )
    )
      return;
    setBusyId(id);
    const store = await getStore();
    await store.purgeExpense(id);
    setBusyId(null);
    await onChanged();
  }

  return (
    <Sheet open title="Trash" onClose={onClose}>
      {trashed.length === 0 ? (
        <p className="text-sm text-muted">Trash is empty.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Deleted expenses. Restore them, or delete permanently to remove for
            good.
          </p>
          {trashed.map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {e.label || "Expense"}
                  </div>
                  <div className="text-xs text-muted">
                    {memberName(bundle.members, e.payerMemberId)} paid ·{" "}
                    {formatDate(e.date)}
                  </div>
                </div>
                <div className="text-right text-sm font-medium">
                  {formatMoney(
                    computeExpenseBreakdown(e, bundle.group.homeCurrency)
                      .grossTotal,
                    e.currency,
                  )}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-brand flex-1"
                  disabled={busyId === e.id}
                  onClick={() => restore(e.id)}
                >
                  Restore
                </button>
                <button
                  className="btn-outline text-negative"
                  disabled={busyId === e.id}
                  onClick={() => purge(e.id, e.label)}
                >
                  Delete forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
