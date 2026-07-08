"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDateLong,
  formatMoney,
  formatRelative,
  memberName,
} from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { forgetGroup, rememberGroup } from "@/lib/recent-groups";
import { getStore } from "@/lib/store";
import {
  computeBalances,
  computeExpenseBreakdown,
  simplifyDebts,
} from "@/lib/split";
import { groupCurrencies, type ExpenseRecord, type GroupBundle } from "@/lib/types";
import { AddExpenseSheet } from "./AddExpenseSheet";
import { GroupSettingsSheet } from "./GroupSettingsSheet";
import { HistorySheet } from "./HistorySheet";
import { MembersSheet } from "./MembersSheet";
import { SettleUpSheet } from "./SettleUpSheet";
import { TrashSheet } from "./TrashSheet";
import { Avatar } from "./ui";

type SheetName =
  | "add"
  | "settle"
  | "members"
  | "settings"
  | "history"
  | "trash"
  | null;

export default function GroupApp({ code }: { code: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<GroupBundle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const [sheet, setSheet] = useState<SheetName>(null);
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const store = await getStore();
    const b = await store.getGroupByCode(code);
    setBundle(b);
    setStatus(b ? "ready" : "missing");
    if (b) {
      rememberGroup({
        code: b.group.shareCode,
        name: b.group.name,
        homeCurrency: b.group.homeCurrency,
      });
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  // Subscribe to realtime/local changes once we know the group id.
  const groupId = bundle?.group.id;
  useEffect(() => {
    if (!groupId) return;
    let active = true;
    let unsub = () => {};
    (async () => {
      const store = await getStore();
      if (active) unsub = store.subscribe(groupId, load);
    })();
    return () => {
      active = false;
      unsub();
    };
  }, [groupId, load]);

  const home = bundle?.group.homeCurrency ?? "USD";
  const memberIds = useMemo(
    () => (bundle ? bundle.members.map((m) => m.id) : []),
    [bundle],
  );

  // Balances (and the active screen) reflect only un-archived activity.
  const balances = useMemo(() => {
    if (!bundle) return [];
    return computeBalances(
      memberIds,
      bundle.expenses.filter((e) => !e.archivedAt && !e.deletedAt),
      home,
      bundle.settlements.filter((s) => !s.archivedAt),
    );
  }, [bundle, memberIds, home]);

  const transfers = useMemo(
    () => simplifyDebts(balances, home),
    [balances, home],
  );

  if (status === "loading") {
    return <Centered>Loading…</Centered>;
  }
  if (status === "missing" || !bundle) {
    return (
      <Centered>
        <p className="mb-4 text-muted">No group found for code {code}.</p>
        <Link href="/" className="btn-brand">
          Back to start
        </Link>
      </Centered>
    );
  }

  const { group, members } = bundle;
  const live = bundle.expenses.filter((e) => !e.deletedAt); // not trashed
  const expenses = live.filter((e) => !e.archivedAt); // active view
  const archivedCount = live.length - expenses.length;
  const trashedCount = bundle.expenses.length - live.length;
  const allSettled =
    expenses.length > 0 && balances.every((b) => Math.abs(b.amount) < 0.005);
  // The most recently *entered* expense (not necessarily the newest-dated) —
  // this is what confirms "did my last entry save?".
  const lastAdded = expenses.length
    ? expenses.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b))
    : null;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/g/${group.shareCode}`
      : "";

  async function copyInvite() {
    const ok = await copyToClipboard(shareUrl || group.shareCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="flex min-h-screen flex-col pb-28">
      {/* Header */}
      <header className="bg-brand px-5 pb-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] text-white">
        <div className="flex items-start justify-between">
          <div>
            <Link href="/" className="text-xs text-white/70">
              ← All groups
            </Link>
            <h1 className="mt-1 text-xl font-bold">{group.name}</h1>
            <button
              onClick={() => setSheet("settings")}
              className="mt-0.5 text-left text-sm text-white/80 hover:text-white"
            >
              {groupCurrencies(group).join(" · ")} · edit ⚙
            </button>
          </div>
          <button
            onClick={copyInvite}
            className="rounded-xl bg-white/15 px-3 py-2 text-center text-xs font-semibold backdrop-blur"
          >
            <div className="text-white/70">Invite code</div>
            <div className="text-base tracking-[0.2em]">{group.shareCode}</div>
            <div className="text-white/70">{copied ? "Copied!" : "Tap to copy"}</div>
          </button>
        </div>
        <button
          onClick={() => setSheet("members")}
          className="mt-4 flex items-center gap-1"
        >
          {members.length === 0 ? (
            <span className="text-sm text-white/80">+ Add members</span>
          ) : (
            <>
              <div className="flex -space-x-2">
                {members.slice(0, 6).map((m) => (
                  <span key={m.id} className="ring-2 ring-brand rounded-full">
                    <Avatar name={m.name} color={m.color} size={30} />
                  </span>
                ))}
              </div>
              <span className="ml-2 text-sm text-white/80">
                {members.length} {members.length === 1 ? "member" : "members"} ›
              </span>
            </>
          )}
        </button>
      </header>

      <main className="space-y-5 px-5 py-5">
        {members.length === 0 ? (
          <EmptyState
            title="Add your group first"
            hint="You need people in the group before you can log expenses."
            cta="+ Add members"
            onAction={() => setSheet("members")}
          />
        ) : expenses.length === 0 ? (
          <EmptyState
            title="No expenses yet"
            hint="Log what you spend as you go — you can settle up any time."
            cta="+ Add your first expense"
            onAction={() => {
              setEditing(null);
              setSheet("add");
            }}
          />
        ) : (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-muted">Expenses</h2>
              <span className="text-xs text-muted">{expenses.length} total</span>
            </div>
            <div className="space-y-5">
              {groupByDay(expenses).map(([day, items]) => {
                const dayTotal = items.reduce(
                  (sum, e) =>
                    sum +
                    computeExpenseBreakdown(e, home).grossTotal * e.fxRateToHome,
                  0,
                );
                return (
                  <div key={day}>
                    <div className="mb-1.5 flex items-baseline justify-between px-1">
                      <span className="text-xs font-semibold text-muted">
                        {formatDateLong(day)}
                      </span>
                      <span className="text-xs text-muted">
                        {formatMoney(dayTotal, home)}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((e) => (
                        <ExpenseRow
                          key={e.id}
                          expense={e}
                          bundle={bundle}
                          justAdded={e.id === lastAdded?.id}
                          onClick={() => {
                            setEditing(e);
                            setSheet("add");
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(archivedCount > 0 || trashedCount > 0) && (
          <div className="flex justify-center gap-4 pt-2 text-xs">
            {archivedCount > 0 && (
              <button
                onClick={() => setSheet("history")}
                className="text-muted hover:text-foreground"
              >
                📁 History · {archivedCount}
              </button>
            )}
            {trashedCount > 0 && (
              <button
                onClick={() => setSheet("trash")}
                className="text-muted hover:text-foreground"
              >
                🗑 Trash · {trashedCount}
              </button>
            )}
          </div>
        )}
      </main>

      {/* Action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-surface/90 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="flex gap-3">
          <button
            className="btn-outline"
            onClick={() => setSheet("settle")}
            disabled={members.length < 2}
          >
            Settle up
          </button>
          <button
            className="btn-brand flex-1"
            onClick={() => {
              setEditing(null);
              setSheet("add");
            }}
            disabled={members.length < 1}
          >
            + Add expense
          </button>
        </div>
      </div>

      {sheet === "add" && (
        <AddExpenseSheet
          bundle={bundle}
          editing={editing}
          onClose={() => setSheet(null)}
          onSaved={async () => {
            setSheet(null);
            await load();
          }}
        />
      )}
      {sheet === "settle" && (
        <SettleUpSheet
          bundle={bundle}
          balances={balances}
          transfers={transfers}
          canArchive={allSettled}
          onClose={() => setSheet(null)}
          onSettled={async () => {
            await load();
          }}
          onArchive={async () => {
            const store = await getStore();
            await store.archiveSettled(group.id);
            setSheet(null);
            await load();
          }}
        />
      )}
      {sheet === "history" && (
        <HistorySheet bundle={bundle} onClose={() => setSheet(null)} />
      )}
      {sheet === "trash" && (
        <TrashSheet
          bundle={bundle}
          onClose={() => setSheet(null)}
          onChanged={load}
        />
      )}
      {sheet === "members" && (
        <MembersSheet
          bundle={bundle}
          onClose={() => setSheet(null)}
          onChanged={load}
        />
      )}
      {sheet === "settings" && (
        <GroupSettingsSheet
          bundle={bundle}
          onClose={() => setSheet(null)}
          onChanged={load}
          onDeleted={() => {
            forgetGroup(group.shareCode);
            router.push("/");
          }}
        />
      )}
    </div>
  );
}

/** Group expenses by date, newest day first, preserving that order. */
function groupByDay(
  expenses: ExpenseRecord[],
): [string, ExpenseRecord[]][] {
  const sorted = [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const byDay = new Map<string, ExpenseRecord[]>();
  for (const e of sorted) {
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }
  return [...byDay.entries()];
}

function ExpenseRow({
  expense,
  bundle,
  justAdded,
  onClick,
}: {
  expense: ExpenseRecord;
  bundle: GroupBundle;
  justAdded?: boolean;
  onClick: () => void;
}) {
  const home = bundle.group.homeCurrency;
  const breakdown = computeExpenseBreakdown(expense, home);
  const homeTotal = breakdown.grossTotal * expense.fxRateToHome;
  const itemSummary =
    expense.splitMode === "itemized"
      ? expense.lineItems
          .map((i) => i.description?.trim())
          .filter(Boolean)
          .join(", ")
      : "";
  return (
    <button
      onClick={onClick}
      className={`card flex w-full items-center gap-3 p-4 text-left ${
        justAdded ? "ring-1 ring-positive/50" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">
            {expense.label || "Expense"}
          </span>
          {justAdded && (
            <span className="shrink-0 rounded-full bg-positive/10 px-2 py-0.5 text-xs font-medium text-positive">
              added {formatRelative(expense.createdAt)}
            </span>
          )}
        </div>
        <div className="text-xs text-muted">
          {memberName(bundle.members, expense.payerMemberId)} paid ·{" "}
          {expense.splitMode === "equal" ? "split equally" : "itemized"}
        </div>
        {itemSummary && (
          <div className="truncate text-xs text-muted">{itemSummary}</div>
        )}
      </div>
      <div className="text-right">
        <div className="font-semibold">
          {formatMoney(breakdown.grossTotal, expense.currency)}
        </div>
        {expense.currency !== home && (
          <div className="text-xs text-muted">
            ≈ {formatMoney(homeTotal, home)}
          </div>
        )}
      </div>
    </button>
  );
}

function EmptyState({
  title,
  hint,
  cta,
  onAction,
}: {
  title: string;
  hint: string;
  cta: string;
  onAction: () => void;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted">{hint}</p>
      <button className="btn-brand" onClick={onAction}>
        {cta}
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
