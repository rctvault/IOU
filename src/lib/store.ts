// Storage abstraction. The whole UI talks to this interface, so we can run
// fully offline against localStorage today and flip to shared cloud storage
// (Supabase) simply by providing env keys — no UI changes required.

import type {
  GroupBundle,
  Group,
  GroupPatch,
  Member,
  MemberPatch,
  ExpenseRecord,
  SettlementRecord,
  NewGroup,
  NewMember,
  NewExpense,
  NewSettlement,
} from "./types";

export interface Store {
  createGroup(input: NewGroup): Promise<Group>;
  getGroupByCode(code: string): Promise<GroupBundle | null>;
  updateGroup(id: string, patch: GroupPatch): Promise<Group>;
  /** Permanently delete a whole group and all its data. */
  deleteGroup(id: string): Promise<void>;

  addMember(groupId: string, input: NewMember): Promise<Member>;
  updateMember(id: string, patch: MemberPatch): Promise<Member>;
  removeMember(id: string): Promise<void>;

  addExpense(groupId: string, input: NewExpense): Promise<ExpenseRecord>;
  updateExpense(id: string, input: NewExpense): Promise<ExpenseRecord>;
  /** Soft-delete: moves the expense to Trash (recoverable). */
  deleteExpense(id: string): Promise<void>;
  /** Restore an expense from Trash. */
  restoreExpense(id: string): Promise<void>;
  /** Permanently delete an expense (cannot be undone). */
  purgeExpense(id: string): Promise<void>;

  addSettlement(
    groupId: string,
    input: NewSettlement,
  ): Promise<SettlementRecord>;
  deleteSettlement(id: string): Promise<void>;

  /**
   * Archive all currently-active expenses and settlements for a group ("close
   * the books"). Only meaningful when balances are settled; the caller gates
   * this on a zero balance. Archived items stay in history.
   */
  archiveSettled(groupId: string): Promise<void>;

  /**
   * Subscribe to changes for a group. Returns an unsubscribe function.
   * The callback fires whenever any data in the group changes.
   */
  subscribe(groupId: string, onChange: () => void): () => void;
}

export function isCloudEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

let cached: Store | null = null;

/** Returns the active store, choosing Supabase when configured, else local. */
export async function getStore(): Promise<Store> {
  if (cached) return cached;
  if (isCloudEnabled()) {
    const { createSupabaseStore } = await import("./store-supabase");
    cached = createSupabaseStore();
  } else {
    const { createLocalStore } = await import("./store-local");
    cached = createLocalStore();
  }
  return cached;
}
