"use client";

import { formatDateLong, formatMoney, memberName } from "@/lib/format";
import { computeExpenseBreakdown } from "@/lib/split";
import type { GroupBundle } from "@/lib/types";
import { Sheet } from "./ui";

export function HistorySheet({
  bundle,
  onClose,
}: {
  bundle: GroupBundle;
  onClose: () => void;
}) {
  const home = bundle.group.homeCurrency;
  const archived = bundle.expenses
    .filter((e) => e.archivedAt && !e.deletedAt)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // Group by day, newest first.
  const byDay = new Map<string, typeof archived>();
  for (const e of archived) {
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }

  return (
    <Sheet open title="History" onClose={onClose}>
      {archived.length === 0 ? (
        <p className="text-sm text-muted">No archived expenses yet.</p>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-muted">
            Settled expenses that have been archived. Read-only.
          </p>
          {[...byDay.entries()].map(([day, items]) => (
            <div key={day}>
              <div className="mb-1.5 px-1 text-xs font-semibold text-muted">
                {formatDateLong(day)}
              </div>
              <div className="card divide-y divide-border">
                {items.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {e.label || "Expense"}
                      </div>
                      <div className="text-xs text-muted">
                        {memberName(bundle.members, e.payerMemberId)} paid
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium">
                      {formatMoney(
                        computeExpenseBreakdown(e, home).grossTotal,
                        e.currency,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
