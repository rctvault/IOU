// localStorage-backed store. Lets the whole app run with zero configuration on
// a single device — perfect for trying it out. Data is NOT shared across
// devices; configure Supabase (see .env.local.example) for real group sharing.

import { nextColor, shareCode, uid } from "./ids";
import type { Store } from "./store";
import type {
  ExpenseRecord,
  GroupBundle,
  GroupPatch,
  Member,
  MemberPatch,
  NewExpense,
  NewGroup,
  NewMember,
  NewSettlement,
  SettlementRecord,
} from "./types";

/** Normalise a currency list so it always includes home and has no dupes. */
function normalizeCurrencies(home: string, extra?: string[]): string[] {
  return [home, ...(extra ?? [])].filter((c, i, a) => c && a.indexOf(c) === i);
}

const INDEX_KEY = "tracker:index"; // { [shareCode]: groupId }
const groupKey = (id: string) => `tracker:group:${id}`;
const CHANGE_EVENT = "tracker:change";

function readIndex(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeIndex(idx: Record<string, string>) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function readBundle(groupId: string): GroupBundle | null {
  const raw = localStorage.getItem(groupKey(groupId));
  return raw ? (JSON.parse(raw) as GroupBundle) : null;
}

function writeBundle(bundle: GroupBundle) {
  localStorage.setItem(groupKey(bundle.group.id), JSON.stringify(bundle));
  // Notify same-tab listeners (the `storage` event only fires in other tabs).
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, { detail: bundle.group.id }),
  );
}

function requireBundle(groupId: string): GroupBundle {
  const b = readBundle(groupId);
  if (!b) throw new Error(`Group ${groupId} not found`);
  return b;
}

/** Find which group an entity belongs to by scanning the index. */
function findGroupContaining(
  predicate: (b: GroupBundle) => boolean,
): GroupBundle | null {
  const idx = readIndex();
  for (const groupId of Object.values(idx)) {
    const b = readBundle(groupId);
    if (b && predicate(b)) return b;
  }
  return null;
}

export function createLocalStore(): Store {
  return {
    async createGroup(input: NewGroup) {
      const idx = readIndex();
      let code = shareCode();
      while (idx[code]) code = shareCode();

      const group = {
        id: uid(),
        name: input.name,
        homeCurrency: input.homeCurrency,
        currencies: normalizeCurrencies(input.homeCurrency, input.currencies),
        fxRates: {},
        shareCode: code,
        createdAt: new Date().toISOString(),
      };
      writeBundle({ group, members: [], expenses: [], settlements: [] });
      idx[code] = group.id;
      writeIndex(idx);
      return group;
    },

    async getGroupByCode(code: string) {
      const idx = readIndex();
      const groupId = idx[code.toUpperCase()];
      return groupId ? readBundle(groupId) : null;
    },

    async deleteGroup(id: string) {
      const idx = readIndex();
      for (const [code, gid] of Object.entries(idx)) {
        if (gid === id) delete idx[code];
      }
      writeIndex(idx);
      localStorage.removeItem(groupKey(id));
    },

    async updateGroup(id: string, patch: GroupPatch) {
      const bundle = requireBundle(id);
      const g = bundle.group;
      if (patch.name !== undefined) g.name = patch.name;
      if (patch.homeCurrency !== undefined) g.homeCurrency = patch.homeCurrency;
      if (patch.currencies !== undefined || patch.homeCurrency !== undefined) {
        g.currencies = normalizeCurrencies(
          g.homeCurrency,
          patch.currencies ?? g.currencies,
        );
      }
      if (patch.fxRates !== undefined) g.fxRates = patch.fxRates;
      writeBundle(bundle);
      return g;
    },

    async addMember(groupId: string, input: NewMember) {
      const bundle = requireBundle(groupId);
      const member: Member = {
        id: uid(),
        groupId,
        name: input.name,
        color: input.color || nextColor(bundle.members.length),
        active: true,
        createdAt: new Date().toISOString(),
      };
      bundle.members.push(member);
      writeBundle(bundle);
      return member;
    },

    async updateMember(id: string, patch: MemberPatch) {
      const bundle = findGroupContaining((b) =>
        b.members.some((m) => m.id === id),
      );
      if (!bundle) throw new Error(`Member ${id} not found`);
      const member = bundle.members.find((m) => m.id === id)!;
      Object.assign(member, patch);
      writeBundle(bundle);
      return member;
    },

    async removeMember(id: string) {
      const bundle = findGroupContaining((b) =>
        b.members.some((m) => m.id === id),
      );
      if (!bundle) return;
      bundle.members = bundle.members.filter((m) => m.id !== id);
      writeBundle(bundle);
    },

    async addExpense(groupId: string, input: NewExpense) {
      const bundle = requireBundle(groupId);
      const expense: ExpenseRecord = {
        ...input,
        id: uid(),
        groupId,
        createdAt: new Date().toISOString(),
      };
      bundle.expenses.push(expense);
      writeBundle(bundle);
      return expense;
    },

    async updateExpense(id: string, input: NewExpense) {
      const bundle = findGroupContaining((b) =>
        b.expenses.some((e) => e.id === id),
      );
      if (!bundle) throw new Error(`Expense ${id} not found`);
      const idx = bundle.expenses.findIndex((e) => e.id === id);
      const updated: ExpenseRecord = {
        ...bundle.expenses[idx],
        ...input,
        id,
        groupId: bundle.group.id,
      };
      bundle.expenses[idx] = updated;
      writeBundle(bundle);
      return updated;
    },

    async deleteExpense(id: string) {
      const bundle = findGroupContaining((b) =>
        b.expenses.some((e) => e.id === id),
      );
      if (!bundle) return;
      const e = bundle.expenses.find((x) => x.id === id);
      if (e) e.deletedAt = new Date().toISOString();
      writeBundle(bundle);
    },

    async restoreExpense(id: string) {
      const bundle = findGroupContaining((b) =>
        b.expenses.some((e) => e.id === id),
      );
      if (!bundle) return;
      const e = bundle.expenses.find((x) => x.id === id);
      if (e) e.deletedAt = null;
      writeBundle(bundle);
    },

    async purgeExpense(id: string) {
      const bundle = findGroupContaining((b) =>
        b.expenses.some((e) => e.id === id),
      );
      if (!bundle) return;
      bundle.expenses = bundle.expenses.filter((e) => e.id !== id);
      writeBundle(bundle);
    },

    async addSettlement(groupId: string, input: NewSettlement) {
      const bundle = requireBundle(groupId);
      const settlement: SettlementRecord = {
        ...input,
        id: uid(),
        groupId,
        createdAt: new Date().toISOString(),
      };
      bundle.settlements.push(settlement);
      writeBundle(bundle);
      return settlement;
    },

    async deleteSettlement(id: string) {
      const bundle = findGroupContaining((b) =>
        b.settlements.some((s) => s.id === id),
      );
      if (!bundle) return;
      bundle.settlements = bundle.settlements.filter((s) => s.id !== id);
      writeBundle(bundle);
    },

    async archiveSettled(groupId: string) {
      const bundle = requireBundle(groupId);
      const now = new Date().toISOString();
      for (const e of bundle.expenses)
        if (!e.archivedAt && !e.deletedAt) e.archivedAt = now;
      for (const s of bundle.settlements) if (!s.archivedAt) s.archivedAt = now;
      writeBundle(bundle);
    },

    subscribe(groupId: string, onChange: () => void) {
      const onCustom = (e: Event) => {
        if ((e as CustomEvent).detail === groupId) onChange();
      };
      const onStorage = (e: StorageEvent) => {
        if (e.key === groupKey(groupId)) onChange();
      };
      window.addEventListener(CHANGE_EVENT, onCustom);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(CHANGE_EVENT, onCustom);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}
