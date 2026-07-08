// Integration test for the localStorage store + split math, exercising a full
// group lifecycle without a browser. Stubs the tiny bit of DOM the store uses.

import { beforeEach, describe, expect, it } from "vitest";
import { computeBalances, simplifyDebts } from "./split";

const mem = new Map<string, string>();
// Minimal localStorage + window shims for the Node test environment.
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;
(globalThis as unknown as { window: Window }).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as Window;
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, opts?: { detail?: unknown }) {
    this.type = type;
    this.detail = opts?.detail;
  }
};

// Import AFTER the shims are in place.
const { createLocalStore } = await import("./store-local");

describe("localStorage store — full lifecycle", () => {
  beforeEach(() => mem.clear());

  it("creates a group, tracks expenses, and settles up", async () => {
    const store = createLocalStore();

    const group = await store.createGroup({
      name: "Japan trip",
      homeCurrency: "USD",
    });
    expect(group.shareCode).toHaveLength(6);

    const alice = await store.addMember(group.id, { name: "Alice", color: "#f00" });
    const bob = await store.addMember(group.id, { name: "Bob", color: "#0f0" });

    // Alice pays a ¥10,000 dinner (JPY), 10% tax, split equally, Bob gets 50% off.
    await store.addExpense(group.id, {
      label: "Dinner",
      payerMemberId: alice.id,
      currency: "JPY",
      fxRateToHome: 0.0064,
      taxRate: 10,
      splitMode: "equal",
      subtotal: 10000,
      lineItems: [],
      participants: [
        { memberId: alice.id, discountPct: 0 },
        { memberId: bob.id, discountPct: 50 },
      ],
      date: "2026-07-06",
    });

    // Reload the group as the UI would, and compute balances.
    const bundle = (await store.getGroupByCode(group.shareCode))!;
    expect(bundle.members).toHaveLength(2);
    expect(bundle.expenses).toHaveLength(1);

    const memberIds = bundle.members.map((m) => m.id);
    let balances = computeBalances(
      memberIds,
      bundle.expenses,
      bundle.group.homeCurrency,
      bundle.settlements,
    );

    // Bob's gross share = 5500 JPY, 50% off => owes 2750 JPY => * 0.0064 = 17.6 USD.
    const bobBal = balances.find((b) => b.memberId === bob.id)!;
    const aliceBal = balances.find((b) => b.memberId === alice.id)!;
    expect(bobBal.amount).toBeCloseTo(-17.6, 2);
    expect(aliceBal.amount).toBeCloseTo(17.6, 2);

    // Settle up: Bob pays Alice.
    const transfers = simplifyDebts(balances, bundle.group.homeCurrency);
    expect(transfers).toEqual([
      { fromMemberId: bob.id, toMemberId: alice.id, amount: 17.6 },
    ]);

    await store.addSettlement(group.id, {
      fromMemberId: bob.id,
      toMemberId: alice.id,
      amount: 17.6,
      date: "2026-07-06",
    });

    const settled = (await store.getGroupByCode(group.shareCode))!;
    balances = computeBalances(
      memberIds,
      settled.expenses,
      settled.group.homeCurrency,
      settled.settlements,
    );
    for (const b of balances) expect(Math.abs(b.amount)).toBeLessThan(0.005);
  });

  it("stores and edits the group's trip currencies", async () => {
    const store = createLocalStore();

    // Home is always included and de-duplicated, even if passed again.
    const group = await store.createGroup({
      name: "Euro tour",
      homeCurrency: "USD",
      currencies: ["USD", "EUR", "GBP"],
    });
    expect(group.currencies).toEqual(["USD", "EUR", "GBP"]);

    // Editing the list later persists and keeps home first.
    const updated = await store.updateGroup(group.id, {
      currencies: ["USD", "EUR", "CHF"],
    });
    expect(updated.currencies).toEqual(["USD", "EUR", "CHF"]);

    const reloaded = (await store.getGroupByCode(group.shareCode))!;
    expect(reloaded.group.currencies).toEqual(["USD", "EUR", "CHF"]);
  });

  it("archives settled activity and supports marking a member as left", async () => {
    const store = createLocalStore();
    const group = await store.createGroup({ name: "Trip", homeCurrency: "USD" });
    const a = await store.addMember(group.id, { name: "A", color: "#f00" });
    const b = await store.addMember(group.id, { name: "B", color: "#0f0" });

    await store.addExpense(group.id, {
      label: "Lunch",
      payerMemberId: a.id,
      currency: "USD",
      fxRateToHome: 1,
      taxRate: 0,
      splitMode: "equal",
      subtotal: 100,
      lineItems: [],
      participants: [
        { memberId: a.id, discountPct: 0 },
        { memberId: b.id, discountPct: 0 },
      ],
      date: "2026-07-06",
    });
    // B settles their $50, then archive the closed batch.
    await store.addSettlement(group.id, {
      fromMemberId: b.id,
      toMemberId: a.id,
      amount: 50,
      date: "2026-07-06",
    });
    await store.archiveSettled(group.id);

    const after = (await store.getGroupByCode(group.shareCode))!;
    expect(after.expenses.every((e) => e.archivedAt)).toBe(true);
    expect(after.settlements.every((s) => s.archivedAt)).toBe(true);
    // Active view (un-archived) is now empty → fresh start.
    expect(after.expenses.filter((e) => !e.archivedAt)).toHaveLength(0);

    // Mark B as left; it persists and does not touch archived history.
    await store.updateMember(b.id, { active: false });
    const reloaded = (await store.getGroupByCode(group.shareCode))!;
    expect(reloaded.members.find((m) => m.id === b.id)?.active).toBe(false);
    expect(reloaded.expenses).toHaveLength(1); // still there, archived
  });

  it("soft-deletes to Trash, restores, and purges", async () => {
    const store = createLocalStore();
    const group = await store.createGroup({ name: "T", homeCurrency: "USD" });
    const a = await store.addMember(group.id, { name: "A", color: "#f00" });
    const exp = await store.addExpense(group.id, {
      label: "Coffee",
      payerMemberId: a.id,
      currency: "USD",
      fxRateToHome: 1,
      taxRate: 0,
      splitMode: "equal",
      subtotal: 8,
      lineItems: [],
      participants: [{ memberId: a.id, discountPct: 0 }],
      date: "2026-07-06",
    });

    // Delete → soft-deleted (still present, but marked).
    await store.deleteExpense(exp.id);
    let g = (await store.getGroupByCode(group.shareCode))!;
    expect(g.expenses).toHaveLength(1);
    expect(g.expenses[0].deletedAt).toBeTruthy();

    // Restore → back to active.
    await store.restoreExpense(exp.id);
    g = (await store.getGroupByCode(group.shareCode))!;
    expect(g.expenses[0].deletedAt == null).toBe(true);

    // Delete then purge → gone for good.
    await store.deleteExpense(exp.id);
    await store.purgeExpense(exp.id);
    g = (await store.getGroupByCode(group.shareCode))!;
    expect(g.expenses).toHaveLength(0);
  });

  it("deletes a whole group", async () => {
    const store = createLocalStore();
    const group = await store.createGroup({ name: "Bye", homeCurrency: "USD" });
    expect(await store.getGroupByCode(group.shareCode)).not.toBeNull();
    await store.deleteGroup(group.id);
    expect(await store.getGroupByCode(group.shareCode)).toBeNull();
  });
});
