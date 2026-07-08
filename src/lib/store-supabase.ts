// Supabase-backed store, locked-down edition. All access goes through the
// share_code-gated SECURITY DEFINER functions in supabase/schema.sql — the
// tables themselves deny direct anon access. Activated automatically when
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.

import { supabase } from "./supabase-client";
import type { Store } from "./store";
import type {
  ExpenseRecord,
  Group,
  GroupBundle,
  Member,
  NewExpense,
  NewGroup,
  NewMember,
  NewSettlement,
  SettlementRecord,
} from "./types";

/* ---- row -> domain mappers (functions return snake_case rows) ---- */

type GroupRow = {
  id: string;
  name: string;
  home_currency: string;
  currencies: string[] | null;
  fx_rates: Group["fxRates"] | null;
  share_code: string;
  created_at: string;
};
const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  name: r.name,
  homeCurrency: r.home_currency,
  currencies: r.currencies?.length ? r.currencies : [r.home_currency],
  fxRates: r.fx_rates ?? {},
  shareCode: r.share_code,
  createdAt: r.created_at,
});

type MemberRow = {
  id: string;
  group_id: string;
  name: string;
  color: string;
  active: boolean | null;
  created_at: string;
};
const toMember = (r: MemberRow): Member => ({
  id: r.id,
  groupId: r.group_id,
  name: r.name,
  color: r.color,
  active: r.active ?? true,
  createdAt: r.created_at,
});

type ExpenseRow = {
  id: string;
  group_id: string;
  label: string;
  payer_member_id: string;
  currency: string;
  fx_rate_to_home: number;
  tax_rate: number;
  split_mode: "equal" | "itemized";
  subtotal: number | null;
  line_items: ExpenseRecord["lineItems"];
  participants: ExpenseRecord["participants"];
  date: string;
  note: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
};
const toExpense = (r: ExpenseRow): ExpenseRecord => ({
  id: r.id,
  groupId: r.group_id,
  label: r.label,
  payerMemberId: r.payer_member_id,
  currency: r.currency,
  fxRateToHome: Number(r.fx_rate_to_home),
  taxRate: Number(r.tax_rate),
  splitMode: r.split_mode,
  subtotal: r.subtotal == null ? undefined : Number(r.subtotal),
  lineItems: r.line_items ?? [],
  participants: r.participants ?? [],
  date: r.date,
  note: r.note ?? undefined,
  archivedAt: r.archived_at,
  deletedAt: r.deleted_at,
  createdAt: r.created_at,
});

type SettlementRow = {
  id: string;
  group_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  date: string;
  note: string | null;
  archived_at: string | null;
  created_at: string;
};
const toSettlement = (r: SettlementRow): SettlementRecord => ({
  id: r.id,
  groupId: r.group_id,
  fromMemberId: r.from_member_id,
  toMemberId: r.to_member_id,
  amount: Number(r.amount),
  date: r.date,
  note: r.note ?? undefined,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
});

/** The expense payload the RPCs expect (camelCase jsonb). */
function expensePayload(e: NewExpense) {
  return {
    label: e.label,
    payerMemberId: e.payerMemberId,
    currency: e.currency,
    fxRateToHome: e.fxRateToHome,
    taxRate: e.taxRate,
    splitMode: e.splitMode,
    subtotal: e.subtotal ?? null,
    lineItems: e.lineItems,
    participants: e.participants,
    date: e.date,
    note: e.note ?? null,
  };
}

function normalizeCurrencies(home: string, extra?: string[]): string[] {
  return [home, ...(extra ?? [])].filter((c, i, a) => c && a.indexOf(c) === i);
}

export function createSupabaseStore(): Store {
  const db = supabase();

  // Every write is gated by the open group's share_code. The UI only ever
  // mutates the group it has loaded, so we remember its code on load/create.
  let activeCode: string | null = null;
  const requireCode = (): string => {
    if (!activeCode) throw new Error("No group is open");
    return activeCode;
  };

  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw error;
    return data as T;
  };

  return {
    async createGroup(input: NewGroup) {
      const row = await call<GroupRow>("create_group", {
        p_name: input.name,
        p_home_currency: input.homeCurrency,
        p_currencies: normalizeCurrencies(input.homeCurrency, input.currencies),
      });
      activeCode = row.share_code;
      return toGroup(row);
    },

    async getGroupByCode(code: string) {
      const data = await call<{
        group: GroupRow;
        members: MemberRow[];
        expenses: ExpenseRow[];
        settlements: SettlementRow[];
      } | null>("get_group_bundle", { p_code: code.toUpperCase() });
      if (!data) return null;
      activeCode = code.toUpperCase();
      const bundle: GroupBundle = {
        group: toGroup(data.group),
        members: (data.members ?? []).map(toMember),
        expenses: (data.expenses ?? []).map(toExpense),
        settlements: (data.settlements ?? []).map(toSettlement),
      };
      return bundle;
    },

    async deleteGroup(_id) {
      await call("delete_group", { p_code: requireCode() });
      activeCode = null;
    },

    async updateGroup(_id, patch) {
      const row = await call<GroupRow>("update_group", {
        p_code: requireCode(),
        p_name: patch.name ?? null,
        p_home_currency: patch.homeCurrency ?? null,
        p_currencies:
          patch.currencies !== undefined || patch.homeCurrency !== undefined
            ? normalizeCurrencies(
                patch.homeCurrency ?? "",
                patch.currencies,
              ).filter(Boolean)
            : null,
        p_fx_rates: patch.fxRates ?? null,
      });
      return toGroup(row);
    },

    async addMember(_groupId, input) {
      const row = await call<MemberRow>("add_member", {
        p_code: requireCode(),
        p_name: input.name,
        p_color: input.color,
      });
      return toMember(row);
    },

    async updateMember(id, patch) {
      const row = await call<MemberRow>("update_member", {
        p_code: requireCode(),
        p_member_id: id,
        p_name: patch.name ?? null,
        p_color: patch.color ?? null,
        p_active: patch.active ?? null,
      });
      return toMember(row);
    },

    async removeMember(id) {
      await call("remove_member", { p_code: requireCode(), p_member_id: id });
    },

    async addExpense(_groupId, input) {
      const row = await call<ExpenseRow>("add_expense", {
        p_code: requireCode(),
        p_expense: expensePayload(input),
      });
      return toExpense(row);
    },

    async updateExpense(id, input) {
      const row = await call<ExpenseRow>("update_expense", {
        p_code: requireCode(),
        p_expense_id: id,
        p_expense: expensePayload(input),
      });
      return toExpense(row);
    },

    async deleteExpense(id) {
      await call("delete_expense", { p_code: requireCode(), p_expense_id: id });
    },

    async restoreExpense(id) {
      await call("restore_expense", { p_code: requireCode(), p_expense_id: id });
    },

    async purgeExpense(id) {
      await call("purge_expense", { p_code: requireCode(), p_expense_id: id });
    },

    async addSettlement(_groupId, input) {
      const row = await call<SettlementRow>("add_settlement", {
        p_code: requireCode(),
        p_settlement: {
          fromMemberId: input.fromMemberId,
          toMemberId: input.toMemberId,
          amount: input.amount,
          date: input.date,
          note: input.note ?? null,
        },
      });
      return toSettlement(row);
    },

    async deleteSettlement(id) {
      await call("delete_settlement", {
        p_code: requireCode(),
        p_settlement_id: id,
      });
    },

    async archiveSettled(_groupId) {
      await call("archive_settled", { p_code: requireCode() });
    },

    // Locked-down tables don't emit realtime row changes to the anon key, so we
    // keep everyone's screen fresh by polling and refetching on focus. For a
    // few people editing a shared trip, ~7s latency is plenty.
    subscribe(_groupId, onChange) {
      const interval = setInterval(onChange, 7000);
      const onFocus = () => {
        if (document.visibilityState === "visible") onChange();
      };
      document.addEventListener("visibilitychange", onFocus);
      window.addEventListener("focus", onFocus);
      return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", onFocus);
        window.removeEventListener("focus", onFocus);
      };
    },
  };
}
