import type { Document } from "mongodb";
import { transactions } from "../db/collections.js";
import { SUMMARY_TOP_COUNTERPARTIES } from "../constants.js";

export interface DailyTransaction {
  counterpartyName: string;
  amount: number;
  currency: string;
}

export interface DailySummary {
  date: Date;
  totalSpent: number;
  currency: string;
  transactions: DailyTransaction[];
}

export interface MonthlySummary {
  month: string;
  totalSpent: number;
  totalReceived: number;
  currency: string;
  topCounterparties: Array<{ name: string; total: number }>;
}

interface Totals {
  totalSpent: number;
  totalReceived: number;
  currency: string | null;
}

// prettier-ignore
const spendGroup = {
  _id: null,
  totalSpent: { $sum: { $cond: [{ $eq: ["$direction", "DBIT"] }, "$amount", 0] } },
  totalReceived: { $sum: { $cond: [{ $eq: ["$direction", "CRDT"] }, "$amount", 0] } },
  currency: { $first: "$currency" },
};

function topSpendStages(limit: number): Document[] {
  return [
    { $group: { _id: "$counterpartyName", total: { $sum: "$amount" } } },
    { $sort: { total: -1 } },
    { $limit: limit },
    { $project: { _id: 0, name: "$_id", total: 1 } },
  ];
}

async function aggregateTotals(matchFilter: Document): Promise<Totals | undefined> {
  const [result] = await transactions()
    .aggregate<Totals>([{ $match: matchFilter }, { $group: spendGroup }])
    .toArray();
  return result;
}

async function aggregateTopSpend(
  matchFilter: Document,
  limit: number,
): Promise<Array<{ name: string; total: number }>> {
  return transactions()
    .aggregate<{ name: string; total: number }>([{ $match: matchFilter }, ...topSpendStages(limit)])
    .toArray();
}

export async function getDailySummary(date: Date): Promise<DailySummary | null> {
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dateFilter = { date: { $gte: date, $lt: nextDay }, direction: "DBIT" as const };

  const totals = await aggregateTotals(dateFilter);
  if (!totals) {
    return null;
  }

  const txDocs = await transactions()
    .find(dateFilter)
    .sort({ amount: -1 })
    .project<DailyTransaction>({
      _id: 0,
      counterpartyName: 1,
      amount: 1,
      currency: 1,
    })
    .toArray();

  return {
    date,
    totalSpent: totals.totalSpent,
    currency: totals.currency ?? "EUR",
    transactions: txDocs,
  };
}

export async function getMonthlySummary(
  year: number,
  month: number,
): Promise<MonthlySummary | null> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const monthFilter = { date: { $gte: start, $lt: end } };

  const totals = await aggregateTotals(monthFilter);
  if (!totals) {
    return null;
  }

  const topCounterparties = await aggregateTopSpend(
    { ...monthFilter, direction: "DBIT" },
    SUMMARY_TOP_COUNTERPARTIES,
  );

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return {
    month: prefix,
    totalSpent: totals.totalSpent,
    totalReceived: totals.totalReceived,
    currency: totals.currency ?? "EUR",
    topCounterparties,
  };
}
