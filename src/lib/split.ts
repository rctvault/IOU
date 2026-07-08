// Core money math for the cost tracker. Pure functions, no I/O — this is the
// module the whole app's correctness hinges on, so it is kept isolated and
// unit-tested (see split.test.ts).
//
// Model recap:
//  - One member (the payer) fronts the whole bill.
//  - Every participant has a pre-tax subtotal (equal share, or their itemized
//    items) plus a proportional share of tax.
//  - The payer may discount a participant (e.g. pay only 50%). The discounted
//    remainder is absorbed by the payer; the merchant total is unchanged.
//  - Balances are tracked in the group's HOME currency. Each expense is
//    converted from its own currency via `fxRateToHome`.

import {
  type CurrencyCode,
  allocateByWeights,
  minorFactor,
  roundMoney,
} from "./currency";

export type SplitMode = "equal" | "itemized";

export interface Participant {
  memberId: string;
  /** 0–100. 0 = pays full share, 50 = pays half, 100 = pays nothing. */
  discountPct: number;
}

export interface LineItem {
  amount: number;
  /** Member who consumed it, or null = shared equally among participants. */
  memberId: string | null;
  /** What the item is, e.g. "Ramen", "Beer". Optional; display-only. */
  description?: string;
}

export interface Expense {
  id: string;
  payerMemberId: string;
  currency: CurrencyCode;
  /** Multiply an amount in `currency` by this to get the home-currency amount. */
  fxRateToHome: number;
  /** Tax as a percentage, e.g. 10 for 10%. */
  taxRate: number;
  splitMode: SplitMode;
  participants: Participant[];
  /** Pre-tax subtotal, used when splitMode === "equal". */
  subtotal?: number;
  /** Line items, used when splitMode === "itemized". */
  lineItems?: LineItem[];
}

export interface Settlement {
  fromMemberId: string;
  toMemberId: string;
  /** Amount in the group's home currency. */
  amount: number;
}

export interface ParticipantShare {
  memberId: string;
  /** Pre-tax subtotal for this person, in the expense currency. */
  subtotal: number;
  /** Tax portion, in the expense currency. */
  tax: number;
  /** subtotal + tax, rounded; these sum exactly to the bill total. */
  gross: number;
  discountPct: number;
  /** What this person owes the payer, in the expense currency (0 for the payer). */
  owed: number;
  /** `owed` converted to the home currency. */
  owedHome: number;
}

export interface ExpenseBreakdown {
  shares: ParticipantShare[];
  /** subtotal + tax across everyone, in the expense currency. */
  grossTotal: number;
  /** What the payer nets back from the others, in the expense currency. */
  reimbursedToPayer: number;
  /** Payer's out-of-pocket after reimbursement, in the expense currency. */
  payerOutOfPocket: number;
}

/** Per-person pre-tax subtotal, before rounding, in the expense currency. */
function rawSubtotals(expense: Expense): Map<string, number> {
  const result = new Map<string, number>();
  const ids = expense.participants.map((p) => p.memberId);
  for (const id of ids) result.set(id, 0);

  if (expense.splitMode === "equal") {
    const total = expense.subtotal ?? 0;
    const per = ids.length > 0 ? total / ids.length : 0;
    for (const id of ids) result.set(id, per);
    return result;
  }

  // Itemized: assigned items go to their member; shared items split equally.
  for (const item of expense.lineItems ?? []) {
    if (item.memberId && result.has(item.memberId)) {
      result.set(item.memberId, (result.get(item.memberId) ?? 0) + item.amount);
    } else {
      // Shared (null member, or assigned to a non-participant) — split equally.
      const per = ids.length > 0 ? item.amount / ids.length : 0;
      for (const id of ids) result.set(id, (result.get(id) ?? 0) + per);
    }
  }
  return result;
}

/**
 * Compute each participant's share, tax, and what they owe the payer for a
 * single expense. Gross shares (subtotal + tax) are allocated with the
 * largest-remainder method so they sum exactly to the rounded bill total.
 */
export function computeExpenseBreakdown(
  expense: Expense,
  homeCurrency: CurrencyCode,
): ExpenseBreakdown {
  const { currency, taxRate, payerMemberId, fxRateToHome } = expense;
  const subs = rawSubtotals(expense);
  const ids = expense.participants.map((p) => p.memberId);

  const subtotalTotal = ids.reduce((a, id) => a + (subs.get(id) ?? 0), 0);
  const grossTotalRaw = subtotalTotal * (1 + taxRate / 100);
  const grossTotal = roundMoney(grossTotalRaw, currency);

  // Allocate the rounded gross total proportionally to each person's subtotal.
  // Gross is proportional to subtotal (same 1+rate factor), so weighting by
  // subtotal gives correct, exactly-summing gross shares.
  const weights = ids.map((id) => subs.get(id) ?? 0);
  const grossShares = allocateByWeights(grossTotal, weights, currency);

  const discountFor = new Map(
    expense.participants.map((p) => [p.memberId, p.discountPct]),
  );

  const shares: ParticipantShare[] = ids.map((id, i) => {
    const gross = grossShares[i];
    const subtotal = roundMoney(subs.get(id) ?? 0, currency);
    const tax = roundMoney(gross - subtotal, currency);
    const discountPct = discountFor.get(id) ?? 0;
    const isPayer = id === payerMemberId;
    const owed = isPayer ? 0 : roundMoney(gross * (1 - discountPct / 100), currency);
    const owedHome = roundMoney(owed * fxRateToHome, homeCurrency);
    return { memberId: id, subtotal, tax, gross, discountPct, owed, owedHome };
  });

  const reimbursedToPayer = roundMoney(
    shares.reduce((a, s) => a + s.owed, 0),
    currency,
  );
  const payerOutOfPocket = roundMoney(grossTotal - reimbursedToPayer, currency);

  return { shares, grossTotal, reimbursedToPayer, payerOutOfPocket };
}

export interface Balance {
  memberId: string;
  /** Net in home currency: positive = is owed money, negative = owes money. */
  amount: number;
}

/**
 * Net balance per member across all expenses and settlements, in the home
 * currency. Positive means the group owes that member; negative means they owe.
 * Balances always sum to (approximately) zero.
 */
export function computeBalances(
  memberIds: string[],
  expenses: Expense[],
  homeCurrency: CurrencyCode,
  settlements: Settlement[] = [],
): Balance[] {
  const bal = new Map<string, number>();
  for (const id of memberIds) bal.set(id, 0);
  const add = (id: string, delta: number) =>
    bal.set(id, (bal.get(id) ?? 0) + delta);

  for (const expense of expenses) {
    const { shares } = computeExpenseBreakdown(expense, homeCurrency);
    for (const s of shares) {
      if (s.memberId === expense.payerMemberId) continue;
      add(s.memberId, -s.owedHome); // this member owes the payer
      add(expense.payerMemberId, s.owedHome); // payer is owed
    }
  }

  // A settlement is a real payment: the payer of the debt reduces what they owe.
  for (const s of settlements) {
    add(s.fromMemberId, s.amount);
    add(s.toMemberId, -s.amount);
  }

  return [...bal.entries()].map(([memberId, amount]) => ({
    memberId,
    amount: roundMoney(amount, homeCurrency),
  }));
}

export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}

/**
 * Reduce a set of balances to a minimal list of "A pays B" transfers using
 * greedy debt simplification (largest debtor settles with largest creditor).
 * `homeCurrency` controls the rounding granularity of the suggested amounts.
 */
export function simplifyDebts(
  balances: Balance[],
  homeCurrency: CurrencyCode,
): Transfer[] {
  const factor = minorFactor(homeCurrency);
  // Work in integer minor units to avoid float drift.
  const debtors: { id: string; amt: number }[] = [];
  const creditors: { id: string; amt: number }[] = [];
  for (const b of balances) {
    const minor = Math.round(b.amount * factor);
    if (minor < 0) debtors.push({ id: b.memberId, amt: -minor });
    else if (minor > 0) creditors.push({ id: b.memberId, amt: minor });
  }

  // Deterministic ordering: largest amounts first, id as tiebreaker.
  const byAmt = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || a.id.localeCompare(b.id);
  debtors.sort(byAmt);
  creditors.sort(byAmt);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) {
      transfers.push({
        fromMemberId: debtors[i].id,
        toMemberId: creditors[j].id,
        amount: pay / factor,
      });
    }
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }

  return transfers;
}
