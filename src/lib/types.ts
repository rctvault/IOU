// Domain types shared across the app and both storage adapters.

import type { CurrencyCode } from "./currency";
import type { LineItem, Participant, SplitMode } from "./split";

export interface Group {
  id: string;
  name: string;
  homeCurrency: CurrencyCode;
  /**
   * Currencies used by this group/trip. The home currency is always included.
   * The expense-entry currency picker is limited to this short list (with an
   * option to add more), instead of the full ISO list.
   */
  currencies: CurrencyCode[];
  /** Short human-shareable code embedded in the URL (/g/<shareCode>). */
  shareCode: string;
  createdAt: string;
}

/** The group's currency list, guaranteed to include home and be de-duplicated. */
export function groupCurrencies(group: Group): CurrencyCode[] {
  const list = group.currencies?.length ? group.currencies : [group.homeCurrency];
  return [group.homeCurrency, ...list].filter(
    (c, i, a) => a.indexOf(c) === i,
  );
}

export interface Member {
  id: string;
  groupId: string;
  name: string;
  /** Hex colour used for avatars/chips. */
  color: string;
  /**
   * false = this person has left the trip: excluded from new expenses by
   * default, but kept in past expenses, balances, and history. Undefined is
   * treated as active (for records created before this field existed).
   */
  active?: boolean;
  createdAt: string;
}

/** A member counts as active unless explicitly marked left. */
export function isActive(m: Member): boolean {
  return m.active !== false;
}

/** A stored expense. Mirrors the `Expense` compute-shape plus persistence fields. */
export interface ExpenseRecord {
  id: string;
  groupId: string;
  label: string;
  payerMemberId: string;
  currency: CurrencyCode;
  fxRateToHome: number;
  taxRate: number;
  splitMode: SplitMode;
  /** Pre-tax subtotal for equal splits. */
  subtotal?: number;
  lineItems: LineItem[];
  participants: Participant[];
  date: string;
  note?: string;
  /** When this expense was archived (books closed). Absent = active. */
  archivedAt?: string | null;
  /** When this expense was moved to Trash. Absent = not deleted. */
  deletedAt?: string | null;
  createdAt: string;
}

export interface SettlementRecord {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  /** In the group's home currency. */
  amount: number;
  date: string;
  note?: string;
  /** When this settlement was archived (books closed). Absent = active. */
  archivedAt?: string | null;
  createdAt: string;
}

/** Everything needed to render a group, fetched in one shot. */
export interface GroupBundle {
  group: Group;
  members: Member[];
  expenses: ExpenseRecord[];
  settlements: SettlementRecord[];
}

// Input shapes for creates (ids/timestamps are assigned by the store).
export type NewGroup = Pick<Group, "name" | "homeCurrency"> & {
  currencies?: CurrencyCode[];
};
export type GroupPatch = Partial<
  Pick<Group, "name" | "homeCurrency" | "currencies">
>;
export type NewMember = Pick<Member, "name" | "color">;
export type MemberPatch = Partial<Pick<Member, "name" | "color" | "active">>;
export type NewExpense = Omit<
  ExpenseRecord,
  "id" | "groupId" | "createdAt" | "archivedAt" | "deletedAt"
>;
export type NewSettlement = Omit<
  SettlementRecord,
  "id" | "groupId" | "createdAt"
>;
