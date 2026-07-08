import { describe, expect, it } from "vitest";
import { allocateByWeights, roundMoney } from "./currency";
import {
  type Expense,
  computeBalances,
  computeExpenseBreakdown,
  simplifyDebts,
} from "./split";

const owedFor = (b: ReturnType<typeof computeExpenseBreakdown>, id: string) =>
  b.shares.find((s) => s.memberId === id)!;

describe("currency helpers", () => {
  it("rounds to the currency minor unit", () => {
    expect(roundMoney(1.005, "USD")).toBe(1.01);
    expect(roundMoney(2749.6, "JPY")).toBe(2750);
    expect(roundMoney(1.2349, "BHD")).toBe(1.235); // 3 decimals
  });

  it("allocates with no lost minor units (largest remainder)", () => {
    const shares = allocateByWeights(10, [1, 1, 1], "USD");
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
    for (const s of shares) expect([3.33, 3.34]).toContain(s);
  });

  it("splits JPY without decimals", () => {
    const shares = allocateByWeights(1000, [1, 1, 1], "JPY");
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    for (const s of shares) expect(Number.isInteger(s)).toBe(true);
  });
});

describe("computeExpenseBreakdown", () => {
  it("equal split with tax and a 50% discount (the plan's worked example)", () => {
    // ¥10,000 dinner, 10% tax, 4 people, p4 at 50%, payer = p1. Home = JPY.
    const expense: Expense = {
      id: "e1",
      payerMemberId: "p1",
      currency: "JPY",
      fxRateToHome: 1,
      taxRate: 10,
      splitMode: "equal",
      subtotal: 10000,
      participants: [
        { memberId: "p1", discountPct: 0 },
        { memberId: "p2", discountPct: 0 },
        { memberId: "p3", discountPct: 0 },
        { memberId: "p4", discountPct: 50 },
      ],
    };

    const b = computeExpenseBreakdown(expense, "JPY");
    expect(b.grossTotal).toBe(11000);
    expect(owedFor(b, "p1").gross).toBe(2750);
    expect(owedFor(b, "p1").owed).toBe(0); // payer owes nothing
    expect(owedFor(b, "p2").owed).toBe(2750);
    expect(owedFor(b, "p3").owed).toBe(2750);
    expect(owedFor(b, "p4").owed).toBe(1375); // 50% discount
    expect(b.reimbursedToPayer).toBe(6875);
    expect(b.payerOutOfPocket).toBe(4125);
  });

  it("itemized split with a shared item", () => {
    const expense: Expense = {
      id: "e2",
      payerMemberId: "p1",
      currency: "USD",
      fxRateToHome: 1,
      taxRate: 10,
      splitMode: "itemized",
      participants: [
        { memberId: "p1", discountPct: 0 },
        { memberId: "p2", discountPct: 0 },
        { memberId: "p3", discountPct: 0 },
      ],
      lineItems: [
        { amount: 40, memberId: "p1" },
        { amount: 20, memberId: "p2" },
        { amount: 30, memberId: "p3" },
        { amount: 30, memberId: null }, // shared wine
      ],
    };

    const b = computeExpenseBreakdown(expense, "USD");
    expect(b.grossTotal).toBe(132); // 120 subtotal + 10% tax
    expect(owedFor(b, "p1").gross).toBe(55); // (40 + 10) * 1.1
    expect(owedFor(b, "p2").owed).toBe(33); // (20 + 10) * 1.1
    expect(owedFor(b, "p3").owed).toBe(44); // (30 + 10) * 1.1
    expect(b.reimbursedToPayer).toBe(77);
    expect(b.payerOutOfPocket).toBe(55);
  });

  it("100% discount means the person owes nothing", () => {
    const expense: Expense = {
      id: "e3",
      payerMemberId: "p1",
      currency: "USD",
      fxRateToHome: 1,
      taxRate: 0,
      splitMode: "equal",
      subtotal: 100,
      participants: [
        { memberId: "p1", discountPct: 0 },
        { memberId: "p2", discountPct: 100 },
      ],
    };
    const b = computeExpenseBreakdown(expense, "USD");
    expect(owedFor(b, "p2").owed).toBe(0);
    expect(b.reimbursedToPayer).toBe(0);
  });

  it("gross shares always sum to the rounded bill total (3-way $10)", () => {
    const expense: Expense = {
      id: "e4",
      payerMemberId: "p1",
      currency: "USD",
      fxRateToHome: 1,
      taxRate: 0,
      splitMode: "equal",
      subtotal: 10,
      participants: [
        { memberId: "p1", discountPct: 0 },
        { memberId: "p2", discountPct: 0 },
        { memberId: "p3", discountPct: 0 },
      ],
    };
    const b = computeExpenseBreakdown(expense, "USD");
    const sum = b.shares.reduce((a, s) => a + s.gross, 0);
    expect(roundMoney(sum, "USD")).toBe(10);
  });
});

describe("computeBalances + simplifyDebts", () => {
  it("nets a multi-currency trip into a single transfer", () => {
    // Home currency: USD. Two people, three expenses in EUR / JPY / THB.
    const expenses: Expense[] = [
      {
        id: "a",
        payerMemberId: "p1",
        currency: "EUR",
        fxRateToHome: 1.1,
        taxRate: 0,
        splitMode: "equal",
        subtotal: 100,
        participants: [
          { memberId: "p1", discountPct: 0 },
          { memberId: "p2", discountPct: 0 },
        ],
      },
      {
        id: "b",
        payerMemberId: "p2",
        currency: "JPY",
        fxRateToHome: 0.007,
        taxRate: 0,
        splitMode: "equal",
        subtotal: 3000,
        participants: [
          { memberId: "p1", discountPct: 0 },
          { memberId: "p2", discountPct: 0 },
        ],
      },
      {
        id: "c",
        payerMemberId: "p1",
        currency: "THB",
        fxRateToHome: 0.03,
        taxRate: 7,
        splitMode: "equal",
        subtotal: 2000,
        participants: [
          { memberId: "p1", discountPct: 0 },
          { memberId: "p2", discountPct: 0 },
        ],
      },
    ];

    const balances = computeBalances(["p1", "p2"], expenses, "USD");
    const p1 = balances.find((b) => b.memberId === "p1")!;
    const p2 = balances.find((b) => b.memberId === "p2")!;
    expect(p1.amount).toBeCloseTo(76.6, 2); // 55 - 10.5 + 32.1
    expect(p2.amount).toBeCloseTo(-76.6, 2);
    expect(balances.reduce((a, b) => a + b.amount, 0)).toBeCloseTo(0, 6);

    const transfers = simplifyDebts(balances, "USD");
    expect(transfers).toEqual([
      { fromMemberId: "p2", toMemberId: "p1", amount: 76.6 },
    ]);
  });

  it("settlements reduce outstanding balances", () => {
    const expenses: Expense[] = [
      {
        id: "a",
        payerMemberId: "p1",
        currency: "USD",
        fxRateToHome: 1,
        taxRate: 0,
        splitMode: "equal",
        subtotal: 100,
        participants: [
          { memberId: "p1", discountPct: 0 },
          { memberId: "p2", discountPct: 0 },
        ],
      },
    ];
    // p2 owes p1 $50; then p2 pays p1 $50 -> everyone settled.
    const balances = computeBalances(["p1", "p2"], expenses, "USD", [
      { fromMemberId: "p2", toMemberId: "p1", amount: 50 },
    ]);
    for (const b of balances) expect(b.amount).toBe(0);
    expect(simplifyDebts(balances, "USD")).toEqual([]);
  });

  it("minimises transfers across three people", () => {
    // p1 paid $90 split equally among 3 -> p2 and p3 each owe $30.
    const expenses: Expense[] = [
      {
        id: "a",
        payerMemberId: "p1",
        currency: "USD",
        fxRateToHome: 1,
        taxRate: 0,
        splitMode: "equal",
        subtotal: 90,
        participants: [
          { memberId: "p1", discountPct: 0 },
          { memberId: "p2", discountPct: 0 },
          { memberId: "p3", discountPct: 0 },
        ],
      },
    ];
    const balances = computeBalances(["p1", "p2", "p3"], expenses, "USD");
    const transfers = simplifyDebts(balances, "USD");
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.toMemberId === "p1")).toBe(true);
    expect(transfers.reduce((a, t) => a + t.amount, 0)).toBe(60);
  });
});
