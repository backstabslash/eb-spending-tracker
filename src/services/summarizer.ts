import type { Document } from "mongodb";
import { transactions } from "../db/collections.js";
import { SUMMARY_TOP_COUNTERPARTIES } from "../constants.js";

export interface DailyTransaction {
  counterpartyName: string;
  amount: number;
  currency: string;
}

export interface CurrencyTotal {
  currency: string;
  spent: number;
  received: number;
}

export interface DailySummary {
  date: Date;
  totals: CurrencyTotal[];
  transactions: DailyTransaction[];
}

export interface TopCounterparty {
  name: string;
  currency: string;
  total: number;
}

export interface MonthlySummary {
  month: string;
  totals: CurrencyTotal[];
  topCounterparties: TopCounterparty[];
}

// Grouped by currency: summing across currencies would produce a plausible-looking wrong total.
// prettier-ignore
const totalsStages: Document[] = [
  { $group: {
      _id: { $ifNull: ["$currency", "EUR"] },
      spent: { $sum: { $cond: [{ $eq: ["$direction", "DBIT"] }, "$amount", 0] } },
      received: { $sum: { $cond: [{ $eq: ["$direction", "CRDT"] }, "$amount", 0] } },
  } },
  { $sort: { spent: -1, received: -1 } },
  { $project: { _id: 0, currency: "$_id", spent: 1, received: 1 } },
];

function topSpendStages(limit: number): Document[] {
  return [
    {
      $group: {
        _id: { name: "$counterpartyName", currency: "$currency" },
        total: { $sum: "$amount" },
      },
    },
    { $sort: { total: -1 } },
    { $limit: limit },
    { $project: { _id: 0, name: "$_id.name", currency: "$_id.currency", total: 1 } },
  ];
}

async function aggregateTotals(matchFilter: Document): Promise<CurrencyTotal[]> {
  return transactions()
    .aggregate<CurrencyTotal>([{ $match: matchFilter }, ...totalsStages])
    .toArray();
}

async function aggregateTopSpend(matchFilter: Document, limit: number): Promise<TopCounterparty[]> {
  return transactions()
    .aggregate<TopCounterparty>([{ $match: matchFilter }, ...topSpendStages(limit)])
    .toArray();
}

export async function getDailySummary(date: Date): Promise<DailySummary | null> {
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dateFilter = { date: { $gte: date, $lt: nextDay }, direction: "DBIT" as const };

  const totals = await aggregateTotals(dateFilter);
  if (totals.length === 0) {
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

  return { date, totals, transactions: txDocs };
}

export async function getMonthlySummary(
  year: number,
  month: number,
): Promise<MonthlySummary | null> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const monthFilter = { date: { $gte: start, $lt: end } };

  const totals = await aggregateTotals(monthFilter);
  if (totals.length === 0) {
    return null;
  }

  const topCounterparties = await aggregateTopSpend(
    { ...monthFilter, direction: "DBIT" },
    SUMMARY_TOP_COUNTERPARTIES,
  );

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return { month: prefix, totals, topCounterparties };
}
